import { Crepe, replaceAll, sinkListItemCommand, liftListItemCommand, callCommand, commonmark, gfm } from './milkdown.mjs';
if (!await globalThis.adminAuthReady)
    throw new Error('Admin authentication required.');
let token = localStorage.getItem('GITHUB_TOKEN');
if (!token && (token = prompt('Token?')))
    localStorage.setItem('GITHUB_TOKEN', token);
let username = localStorage.getItem('user.name');
if (!username && (username = prompt('user name?')))
    localStorage.setItem('user.name', username);
let usermail = localStorage.getItem('user.email');
if (!usermail && (usermail = prompt('user.email')))
    localStorage.setItem('user.email', usermail);
// const dir = "/{{recette.title|slugify}}"
const root = new URL('../admin/', import.meta.url);
const importedItemsPromise = fetch(new URL('imported-items.json', root))
    .then(async (response) => {
    console.log('[imported-items] fetch', response.url, response.status);
    return response.ok ? await response.json() : [];
})
    .then(items => {
    console.log('[imported-items] loaded', items.length);
    return items;
})
    .catch(error => {
    console.error('[imported-items] fetch failed', error);
    return [];
});
await Notification.requestPermission();
const coverImageEl = document.querySelector('.cover-image');
const galleryGridEl = document.querySelector('.gallery-grid');
const isGalleryEditor = !!document.querySelector('.gallery-editor');
let galleryImages = [];
let originalFilepath;
let pendingCoverFile = null;
const pendingGalleryFiles = new Map();
function isBlobUrl(url) {
    return typeof url === 'string' && url.startsWith('blob:');
}
function slugifyTitle(title) {
    return title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[ ’']+/g, '-')
        .replace(/-+/g, '-')
        .toLowerCase();
}
function getRecipeSlug() {
    const title = document.querySelector('h1')?.innerText?.trim();
    if (!title)
        return '';
    return slugifyTitle(title);
}
function safeFilename(name) {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}
function notifyError(message) {
    if (Swal?.fire)
        Swal.fire({
            title: 'Erreur',
            text: message,
            icon: 'error'
        });
    else
        alert(message);
}
function renderCover(coverImageUrl) {
    if (!coverImageEl)
        return;
    if (coverImageUrl) {
        if (window.location.hostname == 'localhost' && coverImageUrl.startsWith('/assets/'))
            fetch(coverImageUrl, { method: 'HEAD' }).then(res => {
                if (!res.ok)
                    coverImageUrl =
                        'https://github.com/npenin/anne/blob/master' +
                            coverImageUrl +
                            '?raw=true';
                coverImageEl.src = coverImageUrl;
            });
        else
            coverImageEl.src = coverImageUrl;
    }
    else {
        coverImageEl.removeAttribute('src');
    }
}
function renderGallery(images) {
    if (!galleryGridEl)
        return;
    galleryImages = Array.isArray(images) ? images : [];
    galleryGridEl.innerHTML = '';
    galleryImages.forEach((url, index) => {
        const figure = document.createElement('figure');
        const img = document.createElement('img');
        img.src = url;
        img.loading = 'lazy';
        img.alt = 'Photo de la recette';
        figure.appendChild(img);
        if (isGalleryEditor) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.classList.add('remove-photo');
            removeBtn.innerHTML = '<i class="fa fa-trash"></i>';
            removeBtn.addEventListener('click', () => {
                if (isBlobUrl(url)) {
                    const file = pendingGalleryFiles.get(url);
                    pendingGalleryFiles.delete(url);
                    if (file)
                        URL.revokeObjectURL(url);
                }
                galleryImages.splice(index, 1);
                renderGallery(galleryImages);
                saveLocally();
            });
            figure.appendChild(removeBtn);
        }
        galleryGridEl.appendChild(figure);
    });
}
/**
 * Loads an image in the browser.
 *
 * When the image is subsequently drawn to a canvas, the browser applies
 * the EXIF orientation while decoding it. The canvas export then strips
 * all EXIF metadata, including GPS data.
 */
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Impossible de lire l’image.'));
        };
        image.src = url;
    });
}
/**
 * Resizes and re-encodes an image entirely client-side.
 *
 * Drawing the source image to a canvas and exporting it removes the
 * original EXIF metadata, including GPS coordinates.
 */
async function processImage(file, options) {
    const image = await loadImage(file);
    const scale = Math.min(1, options.maxWidth / image.naturalWidth, options.maxHeight / image.naturalHeight);
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Impossible de créer le contexte graphique.');
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => {
            if (result)
                resolve(result);
            else
                reject(new Error('Impossible de convertir l’image.'));
        }, 'image/jpeg', options.quality ?? 0.85);
    });
    return {
        blob,
        filename: 'image.jpg',
        width,
        height
    };
}
async function uploadFileToGithub(pathInRepo, contentBase64, message) {
    const apiPath = pathInRepo.replace(/^\/+/, '');
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + apiPath, {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: 'Bearer ' + token,
            'X-GitHub-Api-Version': '2022-11-28'
        },
        method: 'GET'
    });
    let sha;
    if (res.ok)
        sha = (await res.json()).sha;
    else if (res.status !== 404)
        throw new Error(await res.text());
    const body = {
        message,
        committer: {
            name: localStorage.getItem('user.name'),
            email: localStorage.getItem('user.email')
        },
        content: contentBase64,
        sha: undefined
    };
    if (sha)
        body.sha = sha;
    res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + apiPath, {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: 'Bearer ' + token,
            'X-GitHub-Api-Version': '2022-11-28'
        },
        method: 'PUT',
        body: JSON.stringify(body)
    });
    if (!res.ok)
        throw new Error(await res.text());
    return res.json();
}
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result?.toString() || '';
            const base64 = result.split(',')[1];
            resolve(base64 || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
async function handleCoverUpload(file) {
    const slug = getRecipeSlug();
    if (!slug) {
        notifyError('Renseignez le titre de la recette avant de téléverser une couverture.');
        return;
    }
    // Covers are resized to at most 1200x1200 and converted to JPEG.
    // This also removes all EXIF metadata, including GPS coordinates.
    const processed = await processImage(file, {
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.85
    });
    const processedFile = new File([processed.blob], `${safeFilename(file.name).replace(/\.[^.]+$/, '')}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now()
    });
    if (pendingCoverFile?.blobUrl)
        URL.revokeObjectURL(pendingCoverFile.blobUrl);
    const blobUrl = URL.createObjectURL(processedFile);
    pendingCoverFile = {
        file: processedFile,
        blobUrl
    };
    renderCover(blobUrl);
    saveLocally();
}
async function handleGalleryUpload(files) {
    const slug = getRecipeSlug();
    if (!slug) {
        notifyError('Renseignez le titre de la recette avant de téléverser des photos.');
        return;
    }
    const processedFiles = [];
    for (const file of files) {
        // Gallery images are allowed to be larger than covers.
        // Maximum 2048x2048, EXIF/GPS stripped.
        const processed = await processImage(file, {
            maxWidth: 2048,
            maxHeight: 2048,
            quality: 0.85
        });
        const originalName = file instanceof File
            ? file.name
            : 'photo';
        processedFiles.push(new File([processed.blob], `${safeFilename(originalName).replace(/\.[^.]+$/, '')}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now()
        }));
    }
    const blobUrls = processedFiles.map(file => URL.createObjectURL(file));
    const currentGallery = Array.isArray(getRecipe().gallery)
        ? getRecipe().gallery.filter(Boolean)
        : [];
    currentGallery.push(...blobUrls);
    blobUrls.forEach((blobUrl, index) => {
        pendingGalleryFiles.set(blobUrl, processedFiles[index]);
    });
    renderGallery(currentGallery);
    saveLocally();
}
const coverInput = document.querySelector('#coverUpload');
if (coverInput)
    coverInput.addEventListener('change', async (ev) => {
        const file = ev.target.files?.[0];
        if (!file)
            return;
        try {
            await handleCoverUpload(file);
        }
        catch (error) {
            notifyError(error.message || 'Erreur lors du téléversement de la couverture.');
        }
        ev.target.value = '';
    });
const galleryInput = document.querySelector('#galleryUpload');
if (galleryInput)
    galleryInput.addEventListener('change', async (ev) => {
        const files = Array.from(ev.target.files || []);
        if (!files.length)
            return;
        try {
            await handleGalleryUpload(files);
        }
        catch (error) {
            notifyError(error.message || 'Erreur lors du téléversement des photos.');
        }
        ev.target.value = '';
    });
globalThis.triggerCoverUpload = function triggerCoverUpload() {
    coverInput?.click();
};
globalThis.triggerGalleryUpload = function triggerGalleryUpload() {
    galleryInput?.click();
};
globalThis.removeCover = function removeCover() {
    if (pendingCoverFile?.blobUrl)
        URL.revokeObjectURL(pendingCoverFile.blobUrl);
    pendingCoverFile = null;
    renderCover('');
    saveLocally();
};
dynamic(document.querySelector('.info>.mold>.name'), {
    Enter(ev) {
        fetchmold(ev)
            .then(() => ev.target.blur())
            .then(() => saveLocally());
    }
});
globalThis.loadRecipe = function (recipe) {
    originalFilepath = recipe.filepath || originalFilepath;
    document.querySelector('h1').innerText = recipe.title;
    document.querySelector('input[name="private"]').checked = recipe.private;
    document.querySelector('input[name="draft"]').checked = recipe.draft;
    document.querySelector('.info .count').innerText = recipe.for;
    document.querySelector('.info .preptime').innerText = recipe.preptime;
    document.querySelector('.info .resttime').innerText = recipe.resttime;
    document.querySelector('.info .cooktime').innerText = recipe.cooktime;
    document.querySelector('.info .mold>.name').innerText = recipe.mold?.name;
    document.querySelector('.info .mold>a>img').src = recipe.mold?.picture;
    document.querySelector('.info .mold>a').href = recipe.mold?.url;
    recipe.toppings?.forEach(t => {
        const li = addtoppings(false);
        li.querySelector('.quantity').innerText = t.quantity;
        li.querySelector('.unit').innerText = t.unit;
        li.querySelector('.topping').innerText = t.name;
    });
    recipe.accessories?.forEach(a => {
        const li = addAccessory(false);
        li.querySelector('.name').innerText = a.name;
        li.querySelector('img').src = a.picture;
        li.querySelector('a').href = a.url;
    });
    if (typeof recipe.steps === 'string') {
        // After crepe.create() has resolved, call:
        editor.editor.action(replaceAll(mdSteps = recipe.steps));
    }
    else {
        recipe.steps?.forEach(t => {
            const li = addPrepStep(false);
            li.innerText = t;
        });
    }
    pendingCoverFile = null;
    pendingGalleryFiles.clear();
    galleryImages = Array.isArray(recipe.gallery) ? recipe.gallery.filter(Boolean) : [];
    renderCover(recipe.cover || '');
    renderGallery(galleryImages);
    document.querySelectorAll('.toolbar i').forEach(el => el.style.visibility = 'visible');
};
let mdSteps = '';
const editor = new Crepe({
    root: '#steps',
    features: {
        [Crepe.Feature.TopBar]: true,
    },
    featureConfigs: {
        [Crepe.Feature.TopBar]: {
            buildTopBar: (builder) => {
                builder.addGroup('indent', 'Indentation').addItem('left', {
                    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" role="img">
  <title>Outdent</title>
  <line x1="10" y1="6" x2="20" y2="6"/>
  <line x1="10" y1="12" x2="17" y2="12"/>
  <line x1="10" y1="18" x2="20" y2="18"/>
  <line x1="8" y1="12" x2="3" y2="12"/>
  <polyline points="7,8 3,12 7,16"/>
</svg>`,
                    active: () => false,
                    onRun() {
                        return outdent(editor);
                    }
                })
                    .addItem('right', {
                    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" role="img">
  <title>Indent</title>
  <line x1="10" y1="6" x2="20" y2="6"/>
  <line x1="10" y1="12" x2="17" y2="12"/>
  <line x1="10" y1="18" x2="20" y2="18"/>
  <line x1="3" y1="12" x2="8" y2="12"/>
  <polyline points="4,8 8,12 4,16"/>
</svg>`,
                    active: () => false,
                    onRun() {
                        return indent(editor);
                    }
                });
            }
        }
    }
});
// returns true if it actually did something, false if the cursor
// wasn't inside a list item (so it's safe to call unconditionally)
export function outdent(crepe) {
    return !!crepe.editor.action(callCommand(liftListItemCommand.key));
}
export function indent(crepe) {
    return !!crepe.editor.action(callCommand(sinkListItemCommand.key));
}
editor.editor.use(commonmark).use(gfm);
editor.on((listener) => listener.markdownUpdated((ctx, markdown) => { mdSteps = markdown; saveLocally(); }));
await editor.create();
document.querySelector('.mold').addEventListener('click', () => document.querySelector('.info>.mold>.name').focus());
async function fetchmold(ev) {
    const input = ev.target;
    const type = input.closest('.info') ? 'mold' : 'accessory';
    const importedItem = (await importedItemsPromise).find(item => item.type === type && item.name === input.innerText.trim());
    if (importedItem) {
        applyImportedItem(input.closest('.mold'), importedItem);
        return;
    }
    const res = await fetch(new URL(input.innerText
        .replace('https://boutique.guydemarle.com', 'https://d2quloop9d8ihx.cloudfront.net'), root));
    const content = res.text();
    const dummy = document.createElement('div');
    dummy.innerHTML = await content;
    const meta = Object.fromEntries(Array.from(dummy.querySelectorAll('meta'))
        .filter(v => v.attributes.getNamedItem('property'))
        .map(v => [
        v.attributes.getNamedItem('property').value,
        v.attributes.getNamedItem('content').value
    ]));
    const gallerie = JSON.parse(dummy.querySelector('#fancy').dataset.gallerie);
    const productImages = gallerie
        .map(image => image.imgThumbnail || image.img || image.url)
        .filter(Boolean);
    meta['og:image'] = productImages[0];
    meta['og:title'] = gallerie[0].legend;
    dummy.remove();
    input.innerText =
        meta['og:title'];
    const productImage = input
        .parentNode
        .querySelector('img');
    productImage.src = meta['og:image'];
    setupImagePicker(productImage, productImages);
    input
        .parentNode
        .querySelector('a')
        .href = meta['og:url'] || new URL(ev.target
        .innerText
        .replace('https://boutique.guydemarle.com', 'https://d2quloop9d8ihx.cloudfront.net'), root).toString();
}
globalThis.fetchmold = fetchmold;
export function getRecipe() {
    return {
        title: document.querySelector('h1').innerText,
        slug: getRecipeSlug(),
        private: document.querySelector('input[name="private"]').checked,
        draft: document.querySelector('input[name="draft"]').checked,
        toppings: Array.from(document.querySelectorAll('.toppings li')).map(li => ({
            quantity: li.querySelector('.quantity').innerText,
            unit: li.querySelector('.unit').innerText,
            name: li.querySelector('.topping').innerText
        })),
        accessories: Array.from(document.querySelectorAll('.accessories > ul > li')).map(span => ({
            name: span.querySelector('.name').innerText,
            picture: span.querySelector('img').src,
            url: span.querySelector('a').href,
        })),
        steps: mdSteps || Array.from(document.querySelectorAll('.steps li')).map(li => li.innerText),
        for: document.querySelector('.info .count').innerText,
        preptime: document.querySelector('.info .preptime').innerText,
        resttime: document.querySelector('.info .resttime').innerText,
        cooktime: document.querySelector('.info .cooktime').innerText,
        cover: document.querySelector('.cover-image').src,
        gallery: galleryImages,
        mold: {
            name: document.querySelector('.info>.mold>.name').innerText,
            picture: document.querySelector('.info>.mold>a>img').src,
            url: document.querySelector('.info>.mold>a').href,
        },
    };
}
async function blobToBase64(blobUrl) {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return fileToBase64(blob);
}
export async function getRecipeWithBase64Images() {
    const recipe = getRecipe();
    // Convert cover blob to base64
    if (recipe.cover && isBlobUrl(recipe.cover))
        recipe.cover = await blobToBase64(recipe.cover);
    // Convert gallery blobs to base64
    if (Array.isArray(recipe.gallery)) {
        recipe.gallery = await Promise.all(recipe.gallery.map(async (url) => {
            if (url && isBlobUrl(url))
                return await blobToBase64(url);
            return url;
        }));
    }
    return recipe;
}
function saveLocally() {
    getRecipeWithBase64Images()
        .then(recipe => globalThis.saveLocally(recipe));
}
async function commitRecipeRename(oldFilepath, newFilepath, recipe) {
    const apiUrl = 'https://api.github.com/repos/npenin/anne';
    const headers = {
        accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'content-type': 'application/json'
    };
    const request = async (path, method, body) => {
        const response = await fetch(apiUrl + path, {
            headers,
            method,
            body: body ? JSON.stringify(body) : undefined
        });
        if (!response.ok)
            throw new Error(await response.text());
        return await response.json();
    };
    const reference = await request('/git/ref/heads/master', 'GET');
    const parentSha = reference.object.sha;
    const parentCommit = await request('/git/commits/' + parentSha, 'GET');
    const committer = {
        name: localStorage.getItem('user.name'),
        email: localStorage.getItem('user.email')
    };
    const tree = await request('/git/trees', 'POST', {
        base_tree: parentCommit.tree.sha,
        tree: [
            {
                path: `recettes/${newFilepath}.json`,
                mode: '100644',
                type: 'blob',
                content: JSON.stringify(recipe, null, 4)
            },
            {
                path: `recettes/${oldFilepath}.json`,
                mode: '100644',
                type: 'blob',
                sha: null
            }
        ]
    });
    const commit = await request('/git/commits', 'POST', {
        message: 'rename ' + recipe.title,
        tree: tree.sha,
        parents: [parentSha],
        committer
    });
    await request('/git/refs/heads/master', 'PATCH', { sha: commit.sha });
}
async function uploadPendingImages(recipe) {
    const slug = recipe.slug || getRecipeSlug();
    if (!slug)
        throw new Error('Renseignez le titre de la recette avant de sauvegarder.');
    let updatedCover = recipe.cover;
    if (isBlobUrl(updatedCover)) {
        if (!pendingCoverFile?.file)
            throw new Error('La couverture en attente est introuvable. Rechargez l\'image.');
        const filename = safeFilename(pendingCoverFile.file.name || 'couverture');
        const targetPath = `/assets/recettes/${slug}/cover-${filename}`;
        const base64 = await fileToBase64(pendingCoverFile.file);
        await uploadFileToGithub('/wwwroot' + targetPath, base64, `cover ${slug}`);
        updatedCover = targetPath;
        renderCover(updatedCover);
        if (pendingCoverFile?.blobUrl)
            URL.revokeObjectURL(pendingCoverFile.blobUrl);
        pendingCoverFile = null;
    }
    const updatedGallery = [];
    const sourceGallery = Array.isArray(recipe.gallery)
        ? recipe.gallery
        : [];
    for (const url of sourceGallery) {
        if (!url)
            continue;
        if (isBlobUrl(url)) {
            const file = pendingGalleryFiles.get(url);
            if (!file)
                throw new Error('Une photo en attente est introuvable. Rechargez l\'image.');
            const filename = safeFilename(file.name || 'photo');
            const uniqueName = `gallery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}`;
            const targetPath = `wwwroot/assets/recettes/${slug}/${uniqueName}`;
            const base64 = await fileToBase64(file);
            await uploadFileToGithub(targetPath, base64, `gallery ${slug}`);
            updatedGallery.push(`/assets/recettes/${slug}/${uniqueName}`);
            pendingGalleryFiles.delete(url);
        }
        else {
            updatedGallery.push(url);
        }
    }
    galleryImages = updatedGallery;
    renderGallery(galleryImages);
    return { ...recipe, cover: updatedCover, gallery: updatedGallery };
}
globalThis.saveAsDraft = async function saveAsDraft() {
    const recipe = getRecipe();
    globalThis.saveLocally(recipe);
    const filename = `/recettes/${slugifyTitle(recipe.title)}.json`;
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents' +
        filename, {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: 'Bearer ' + token,
            'X-GitHub-Api-Version': '2022-11-28'
        },
        method: 'GET'
    });
    res = await fetch('https://api.github.com/repos/npenin/anne/contents' +
        filename, {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: 'Bearer ' + token,
            'X-GitHub-Api-Version': '2022-11-28'
        },
        method: 'DELETE',
        body: JSON.stringify({
            message: 'delete ' + recipe.title,
            committer: {
                name: localStorage.getItem('user.name'),
                email: localStorage.getItem('user.email')
            },
            sha: (await res.json()).sha
        })
    });
    location.replace('/admin/recette/');
};
globalThis.save = async function save() {
    document.querySelector('.toolbar').style.display = 'none';
    let recipe = getRecipe();
    try {
        recipe = await uploadPendingImages(recipe);
    }
    catch (error) {
        notifyError(error.message || 'Erreur lors du téléversement des images.');
        delete document.querySelector('.toolbar').style.display;
        return;
    }
    const newFilepath = slugifyTitle(recipe.title);
    const filename = `/recettes/${newFilepath}.json`;
    const renamed = !!originalFilepath && originalFilepath !== newFilepath;
    let create = false;
    let res;
    if (renamed) {
        try {
            await commitRecipeRename(originalFilepath, newFilepath, recipe);
            originalFilepath = newFilepath;
            res = new Response(null, { status: 200 });
        }
        catch (error) {
            notifyError(error.message || 'Erreur lors du renommage de la recette.');
            delete document.querySelector('.toolbar').style.display;
            return;
        }
    }
    else {
        res = await fetch('https://api.github.com/repos/npenin/anne/contents' +
            filename, {
            headers: {
                accept: 'application/vnd.github+json',
                authorization: 'Bearer ' + token,
                'X-GitHub-Api-Version': '2022-11-28'
            },
            method: 'GET'
        });
        create = res.status == 404;
        if (create) {
            res = await fetch('https://api.github.com/repos/npenin/anne/contents' +
                filename, {
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: 'Bearer ' + token,
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                method: 'PUT',
                body: JSON.stringify({
                    message: 'create ' + recipe.title,
                    committer: {
                        name: localStorage.getItem('user.name'),
                        email: localStorage.getItem('user.email')
                    },
                    content: btoa(unescape(encodeURIComponent(JSON.stringify(recipe, null, 4))))
                })
            });
        }
        else {
            if (!res.ok) {
                Swal.fire({
                    title: 'Probleme lors de la recuperation',
                    text: await res.text()
                });
                return;
            }
            res = await fetch('https://api.github.com/repos/npenin/anne/contents' +
                filename, {
                headers: {
                    accept: 'application/vnd.github+json',
                    authorization: 'Bearer ' + token,
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                method: 'PUT',
                body: JSON.stringify({
                    message: 'update ' + recipe.title,
                    committer: {
                        name: localStorage.getItem('user.name'),
                        email: localStorage.getItem('user.email')
                    },
                    sha: (await res.json()).sha,
                    content: btoa(unescape(encodeURIComponent(JSON.stringify(recipe, null, 4))))
                })
            });
        }
    }
    if (res.ok) {
        if (create || renamed) {
            globalThis.saveLocally({
                ...recipe,
                toppings: [],
                steps: [],
                title: ''
            });
            let timerInterval;
            Swal.fire({
                title: 'Recette enregistrée !',
                html: 'Redirection vers la recette créée dans <b></b>s...',
                timerProgressBar: true,
                icon: 'success',
                timer: 30000,
                didOpen: () => {
                    Swal.showLoading();
                    const timer = Swal.getPopup().querySelector('b');
                    timerInterval = setInterval(() => {
                        timer.textContent =
                            `${Swal.getTimerLeft() / 1000}`;
                    }, 1000);
                },
                willClose: () => {
                    clearInterval(timerInterval);
                    location.replace(filename
                        .substring(dir.length)
                        .replace('.json', '/'));
                }
            });
        }
        else {
            globalThis.saveLocally(null);
            Swal.fire({
                title: 'Recette enregistrée !',
                timer: 10000,
                timerProgressBar: true,
                icon: 'success',
                willClose: () => {
                    delete document.querySelector('.toolbar').style.display;
                }
            });
        }
        if ('Notification' in globalThis) {
            const notif = await Notification.requestPermission();
            if (notif == "granted")
                new Notification('Recette enregistree');
        }
    }
    else {
        Swal.fire({
            title: 'Une erreur s\'est produite',
            timer: 10000,
            timerProgressBar: true,
            icon: 'error',
            text: await res.text()
        });
    }
};
function addAccessory(focus) {
    const li = document.createElement('li');
    li.classList.add('mold');
    const a = document.createElement('a');
    a.target = '_blank';
    li.appendChild(a);
    const img = document.createElement('img');
    a.appendChild(img);
    const name = document.createElement('span');
    name.classList.add('name');
    name.contentEditable = 'true';
    li.appendChild(name);
    document.querySelector('.accessories>ul').appendChild(li);
    dynamic(name, {
        Enter: (ev) => {
            if (name.innerText.trim() !== '')
                fetchmold(ev).then(() => ev.target.blur()).then(() => saveLocally());
            else {
                li.remove();
                saveLocally();
            }
        }
    });
    if (focus)
        name.focus();
    setupImportedPicker(name, 'accessory');
    return li;
}
globalThis.addAccessory = addAccessory;
function applyImportedItem(container, item) {
    const input = container.querySelector('.name');
    const image = container.querySelector('img');
    const link = container.querySelector('a');
    if (input)
        input.innerText = item.name;
    if (image)
        image.src = item.picture;
    if (link)
        link.href = item.url;
}
function setupImagePicker(image, images) {
    if (image.dataset.hasImagePicker) {
        image.dataset.imagePickerImages = JSON.stringify(images);
        return;
    }
    image.dataset.hasImagePicker = 'true';
    image.dataset.imagePickerImages = JSON.stringify(images);
    image.title = 'Choisir une image';
    image.addEventListener('click', event => {
        event.preventDefault();
        const pickerImages = JSON.parse(image.dataset.imagePickerImages || '[]');
        if (pickerImages.length < 2)
            return;
        document.querySelector('.product-image-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'imported-item-menu product-image-menu';
        menu.setAttribute('role', 'listbox');
        pickerImages.forEach(url => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'imported-item-option product-image-option';
            option.setAttribute('role', 'option');
            const thumbnail = document.createElement('img');
            thumbnail.src = url;
            thumbnail.alt = '';
            option.appendChild(thumbnail);
            option.addEventListener('click', () => {
                image.src = url;
                menu.remove();
                saveLocally();
            });
            menu.appendChild(option);
        });
        document.body.appendChild(menu);
        const bounds = image.getBoundingClientRect();
        menu.style.left = `${bounds.left + window.scrollX}px`;
        menu.style.top = `${bounds.bottom + window.scrollY + 6}px`;
        menu.style.width = `${Math.max(bounds.width, 280)}px`;
        const close = (closeEvent) => {
            if (!menu.contains(closeEvent.target) && closeEvent.target !== image) {
                menu.remove();
                document.removeEventListener('mousedown', close);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', close));
    });
}
async function initializeImportedItems() {
    const items = await importedItemsPromise;
    console.log('[imported-items] initializing', {
        spans: document.querySelectorAll('.mold>.name').length,
        items: items.length
    });
    document.querySelectorAll('.mold>.name').forEach(input => {
        const type = input.closest('.info') ? 'mold' : 'accessory';
        console.log('[imported-items] attach picker', type, input);
        setupImportedPicker(input, type, items);
    });
}
function setupImportedPicker(input, type, loadedItems) {
    let menu;
    let highlightedIndex = -1;
    const close = () => {
        menu?.remove();
        menu = undefined;
        highlightedIndex = -1;
    };
    const render = async () => {
        const allItems = loadedItems || await importedItemsPromise;
        const items = allItems
            .filter(item => item.type === type && item.name.toLocaleLowerCase().includes(input.innerText.trim().toLocaleLowerCase()))
            .slice(0, 8);
        console.log('[imported-items] render', {
            type,
            value: input.innerText,
            matches: items.length
        });
        close();
        if (!items.length)
            return;
        menu = document.createElement('div');
        menu.className = 'imported-item-menu';
        menu.setAttribute('role', 'listbox');
        items.forEach((item, index) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'imported-item-option';
            option.setAttribute('role', 'option');
            const image = document.createElement('img');
            image.src = item.picture;
            image.alt = '';
            const label = document.createElement('span');
            label.innerText = item.name;
            option.append(image, label);
            option.addEventListener('mousedown', event => {
                event.preventDefault();
                applyImportedItem(input.closest('.mold'), item);
                close();
                saveLocally();
            });
            option.addEventListener('mouseenter', () => highlightedIndex = index);
            menu.appendChild(option);
        });
        document.body.appendChild(menu);
        const bounds = input.getBoundingClientRect();
        menu.style.left = `${bounds.left + window.scrollX}px`;
        menu.style.top = `${bounds.bottom + window.scrollY + 6}px`;
        menu.style.width = `${Math.max(bounds.width, 280)}px`;
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', event => {
        if (!menu)
            return;
        const options = Array.from(menu.querySelectorAll('.imported-item-option'));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            highlightedIndex = (highlightedIndex + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
            options.forEach((option, index) => option.classList.toggle('highlighted', index === highlightedIndex));
        }
        else if (event.key === 'Enter' && highlightedIndex >= 0) {
            event.preventDefault();
            options[highlightedIndex].dispatchEvent(new MouseEvent('mousedown'));
        }
        else if (event.key === 'Escape')
            close();
    });
}
initializeImportedItems();
function addPrepStep(focus) {
    const li = document.createElement('li');
    li.contentEditable =
        true;
    document.querySelector('.steps ol').appendChild(li);
    dynamic(li);
    if (focus)
        li.focus();
    li.addEventListener('blur', saveLocally);
    return li;
}
globalThis.addPrepStep = addPrepStep;
function addtoppings(focus) {
    const li = document.createElement('li');
    const quantity = document.createElement('span');
    const unit = document.createElement('span');
    const topping = document.createElement('span');
    quantity.classList.add('quantity');
    unit.classList.add('unit');
    topping.classList.add('topping');
    quantity.contentEditable = true;
    unit.contentEditable = true;
    topping.contentEditable = true;
    li.appendChild(quantity);
    li.appendChild(unit);
    li.appendChild(topping);
    // li.contentEditable = true;
    document.querySelector('.toppings ul').appendChild(li);
    dynamic(quantity, { Enter(ev) { unit.focus(); ev.preventDefault(); return false; } });
    dynamic(unit, { Enter(ev) { topping.focus(); ev.preventDefault(); return false; } });
    dynamic(topping, { Enter(ev) { topping.blur(); setTimeout(() => addtoppings(true)); ev.preventDefault(); return false; } });
    if (focus)
        quantity.focus();
    quantity.addEventListener('blur', saveLocally);
    unit.addEventListener('blur', saveLocally);
    topping.addEventListener('blur', saveLocally);
    return li;
}
globalThis.addtoppings = addtoppings;
function dynamic(self, keys) {
    keys = Object.assign({}, keys);
    self.addEventListener('keydown', function (ev) {
        if (self.innerText === '' &&
            (ev.key == 'Delete' ||
                ev.key == 'Backspace' ||
                ev.key == 'Escape')) {
            self.blur();
        }
        else if (ev.key in keys)
            keys[ev.key](ev);
    });
    self.addEventListener('blur', function () {
        let li = self;
        while (li && li.tagName !== 'LI')
            li = li.parentElement;
        if (li && Array.from(li.querySelectorAll('input')).every(input => input.value == '') && li.textContent == '') {
            li.remove();
            saveLocally();
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyaXB0Lm1qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmlwdC5tdHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQXlDM0gsSUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLGNBQWM7SUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO0FBRXRELElBQUksS0FBSyxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDakQsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDcEMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFFaEQsSUFBSSxRQUFRLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUNqRCxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUM5QyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxRQUFRLENBQUMsQ0FBQztBQUVoRCxJQUFJLFFBQVEsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQ2xELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzlDLFlBQVksQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBRWpELDJDQUEyQztBQUMzQyxNQUFNLElBQUksR0FBRyxJQUFJLEdBQUcsQ0FBQyxXQUFXLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNu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