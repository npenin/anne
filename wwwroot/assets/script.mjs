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
    document.querySelector('.info .count').innerText = recipe.for;
    document.querySelector('.info .preptime').innerText = recipe.preptime;
    document.querySelector('.info .resttime').innerText = recipe.resttime;
    document.querySelector('.info .cooktime').innerText = recipe.cooktime;
    document.querySelector('.info .mold>.name').innerText = recipe.mold?.name;
    document.querySelector('.info .mold>a>img').src = recipe.mold?.picture;
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
    const res = await fetch(new URL(ev.target
        .innerText
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
    meta['og:image'] = gallerie[0].imgThumbnail;
    meta['og:title'] = gallerie[0].legend;
    dummy.remove();
    ev.target.innerText =
        meta['og:title'];
    ev.target
        .parentNode
        .querySelector('img')
        .src = meta['og:image'];
    ev.target
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
            name: document.querySelector('.info>.mold').innerText,
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
    name.contentEditable = true;
    li.appendChild(name);
    document.querySelector('.accessories>ul').appendChild(li);
    dynamic(name, {
        Enter: (ev) => {
            if (ev.target.innerText !== '' && ev.target.innerText !== '\n')
                fetchmold(ev).then(() => ev.target.blur()).then(() => saveLocally());
            else {
                li.remove();
                saveLocally();
            }
        }
    });
    if (focus)
        name.focus();
    return li;
}
globalThis.addAccessory = addAccessory;
function addPrepStep(focus) {
    const li = document.createElement('li');
    li.contentEditable =
        true;
    document
        .querySelector('.steps ol')
        .appendChild(li);
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
        if (li?.textContent == '') {
            li.remove();
            saveLocally();
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyaXB0Lm1qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmlwdC5tdHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQWdDM0gsSUFBSSxDQUFDLE1BQU0sVUFBVSxDQUFDLGNBQWM7SUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO0FBRXRELElBQUksS0FBSyxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDakQsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDcEMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFFaEQsSUFBSSxRQUFRLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUNqRCxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUM5QyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxRQUFRLENBQUMsQ0FBQztBQUVoRCxJQUFJLFFBQVEsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQ2xELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzlDLFlBQVksQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBRWpELE1BQU0sR0FBRyxHQUFHLDRCQUE0QixDQUFBO0FBQ3hDLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFD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