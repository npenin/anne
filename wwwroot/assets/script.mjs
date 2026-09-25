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
const dir = "/{{recette.title|slugify}}";
const root = globalThis.location.href.substring(0, globalThis.location.href.length - '{{page.url}}'.length + '/admin/'.length);
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
    const filename = `${dir}/recettes/${recipe.title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ +/g, '-')
        .toLowerCase()}.json`;
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents/' +
        filename.substring(dir.length + 1), {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: 'Bearer ' + token,
            'X-GitHub-Api-Version': '2022-11-28'
        },
        method: 'GET'
    });
    res = await fetch('https://api.github.com/repos/npenin/anne/contents/' +
        filename.substring(dir.length + 1), {
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
    const filename = `${dir}/recettes/${newFilepath}.json`;
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
        res = await fetch('https://api.github.com/repos/npenin/anne/contents/' +
            filename.substring(dir.length + 1), {
            headers: {
                accept: 'application/vnd.github+json',
                authorization: 'Bearer ' + token,
                'X-GitHub-Api-Version': '2022-11-28'
            },
            method: 'GET'
        });
        create = res.status == 404;
        if (create) {
            res = await fetch('https://api.github.com/repos/npenin/anne/contents/' +
                filename.substring(dir.length + 1), {
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
            res = await fetch('https://api.github.com/repos/npenin/anne/contents/' +
                filename.substring(dir.length + 1), {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyaXB0Lm1qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmlwdC5tdHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQXlDM0gsSUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLGNBQWM7SUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO0FBRXRELElBQUksS0FBSyxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDakQsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDcEMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFFaEQsSUFBSSxRQUFRLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUNqRCxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUM5QyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxRQUFRLENBQUMsQ0FBQztBQUVoRCxJQUFJLFFBQVEsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQ2xELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzlDLFlBQVksQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBRWpELE1BQU0sR0FBRyxHQUFHLDRCQUE0QixDQUFBO0FBQ3hDLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFD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