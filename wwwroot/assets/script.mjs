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
    const create = res.status == 404;
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
    if (res.ok) {
        if (create) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyaXB0Lm1qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmlwdC5tdHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQXdDM0gsSUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLGNBQWM7SUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO0FBRXRELElBQUksS0FBSyxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDakQsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDcEMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFFaEQsSUFBSSxRQUFRLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUNqRCxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUM5QyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxRQUFRLENBQUMsQ0FBQztBQUVoRCxJQUFJLFFBQVEsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQ2xELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzlDLFlBQVksQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBRWpELE1BQU0sR0FBRyxHQUFHLDRCQUE0QixDQUFBO0FBQ3hDLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFD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