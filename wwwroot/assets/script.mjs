import { Crepe, replaceAll, sinkListItemCommand, liftListItemCommand, callCommand, commonmark, gfm } from './milkdown.mjs';
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
        .replace(/[ ’]+/g, '-')
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
        .href = meta['og:url'];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyaXB0Lm1qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmlwdC5tdHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQWdDM0gsSUFBSSxLQUFLLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUNqRCxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNwQyxZQUFZLENBQUMsT0FBTyxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUMsQ0FBQztBQUVoRCxJQUFJLFFBQVEsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBQ2pELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzlDLFlBQVksQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBRWhELElBQUksUUFBUSxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDbEQsSUFBSSxDQUFDLFFBQVEsSUFBSSxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDOUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsUUFBUSxDQUFDLENBQUM7QUFFakQsTUFBTSxHQUFHLEdBQUcsNEJBQTRCLENBQUE7QUFDeEMsTUFBTSxJQUFJLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsY0FBYyxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7QUFFL0gsTUFBTSxZQUFZLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztBQUV2QyxNQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFtQixjQUFjLENBQUMsQ0FBQztBQUM5RSxNQUFNLGFBQWEsR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxDQUFDO0FBQzlELE1BQU0sZUFBZSxHQUFHLENBQUMsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLENBQUM7QUFDcEUsSUFBSSxhQUFhLEdBQWEsRUFBRSxDQUFDO0FBQ2pDLElBQUksZ0JBQWdCLEdBQXdELElBQUksQ0FBQztBQUNqRixNQUFNLG1CQUFtQixHQUFHLElBQUksR0FBRyxFQUFnQixDQUFDO0FBRXBELFNBQVMsU0FBUyxDQUFDLEdBQVk7SUFFM0IsT0FBTyxPQUFPLEdBQUcsS0FBSyxRQUFRLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUM5RCxDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsS0FBYTtJQUUvQixPQUFPLEtBQUs7U0FDUCxTQUFTLENBQUMsS0FBSyxDQUFDO1NBQ2hCLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUM7U0FDL0IsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUM7U0FDdEIsV0FBVyxFQUFFLENBQUM7QUFDdkIsQ0FBQztBQUVELFNBQVMsYUFBYTtJQUVsQixNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQztJQUU5RCxJQUFJLENBQUMsS0FBSztRQUNOLE9BQU8sRUFBRSxDQUFDO0lBRWQsT0FBTyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDL0IsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLElBQVk7SUFFOUIsT0FBTyxJQUFJO1NBQ04sU0FBUyxDQUFDLEtBQUssQ0FBQztTQUNoQixPQUFPLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxDQUFDO1NBQy9CLE9BQU8sQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLENBQUM7U0FDakMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUM7U0FDbkIsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUM7U0FDckIsV0FBVyxFQUFFLENBQUM7QUFDdkIsQ0FBQztBQUVELFNBQVMsV0FBVyxDQUFDLE9BQWU7SUFFaEMsSUFBSSxJQUFJLEVBQUUsSUFBSTtRQUNWLElBQUksQ0FBQyxJQUFJLENBQUM7WUFDTixLQUFLLEVBQUUsUUFBUTtZQUNmLElBQUksRUFBRSxPQUFPO1lBQ2IsSUFBSSxFQUFFLE9BQU87U0FDaEIsQ0FBQyxDQUFDOztRQUVILEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUN2QixDQUFDO0FBRUQsU0FBUyxXQUFXLENBQUMsYUFBcUI7SUFFdEMsSUFBSSxDQUFDLFlBQVk7UUFDYixPQUFPO0lBRVgsSUFBSSxhQUFhLEVBQ2pCLENBQUM7UUFDRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxJQUFJLFdBQVcsSUFBSSxhQUFhLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQztZQUMvRSxLQUFLLENBQUMsYUFBYSxFQUFFLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFO2dCQUVoRCxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUU7b0JBQ1AsYUFBYTt3QkFDVCw0Q0FBNEM7NEJBQzVDLGFBQWE7NEJBQ2IsV0FBVyxDQUFDO2dCQUVwQixZQUFZLENBQUMsR0FBRyxHQUFHLGFBQWEsQ0FBQztZQUNyQyxDQUFDLENBQUMsQ0FBQzs7WUFFSCxZQUFZLENBQUMsR0FBRyxHQUFHLGFBQWEsQ0FBQztJQUN6QyxDQUFDO1NBRUQsQ0FBQztRQUNHLFlBQVksQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDeEMsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFTLGFBQWEsQ0FBQyxNQUFnQjtJQUVuQyxJQUFJLENBQUMsYUFBYTtRQUNkLE9BQU87SUFFWCxhQUFhLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7SUFDcEQsYUFBYSxDQUFDLFNBQVMsR0FBRyxFQUFFLENBQUM7SUFFN0IsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLEVBQUUsRUFBRTtRQUVqQyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sR0FBRyxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFMUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUM7UUFDZCxHQUFHLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQztRQUNyQixHQUFHLENBQUMsR0FBRyxHQUFHLHFCQUFxQixDQUFDO1FBRWhDLE1BQU0sQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFeEIsSUFBSSxlQUFlLEVBQ25CLENBQUM7WUFDRyxNQUFNLFNBQVMsR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBRW5ELFNBQVMsQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDO1lBQzFCLFNBQVMsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ3hDLFNBQVMsQ0FBQyxTQUFTLEdBQUcsNkJBQTZCLENBQUM7WUFFcEQsU0FBUyxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxHQUFHLEVBQUU7Z0JBRXJDLElBQUksU0FBUyxDQUFDLEdBQUcsQ0FBQyxFQUNsQixDQUFDO29CQUNHLE1BQU0sSUFBSSxHQUFHLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDMUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUVoQyxJQUFJLElBQUk7d0JBQ0osR0FBRyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDakMsQ0FBQztnQkFFRCxhQUFhLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQztnQkFDL0IsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDO2dCQUM3QixXQUFXLEVBQUUsQ0FBQztZQUNsQixDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDbEMsQ0FBQztRQUVELGFBQWEsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDdEMsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyxTQUFTLENBQUMsSUFBVTtJQUV6QixPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1FBRW5DLE1BQU0sR0FBRyxHQUFHLEdBQUcsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEMsTUFBTSxLQUFLLEdBQUcsSUFBSSxLQUFLLEVBQUUsQ0FBQztRQUUxQixLQUFLLENBQUMsTUFBTSxHQUFHLEdBQUcsRUFBRTtZQUVoQixHQUFHLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3pCLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNuQixDQUFDLENBQUM7UUFFRixLQUFLLENBQUMsT0FBTyxHQUFHLEdBQUcsRUFBRTtZQUVqQixHQUFHLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3pCLE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLENBQUM7UUFDckQsQ0FBQyxDQUFDO1FBRUYsS0FBSyxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUM7SUFDcEIsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxLQUFLLFVBQVUsWUFBWSxDQUN2QixJQUFVLEVBQ1YsT0FJQztJQUdELE1BQU0sS0FBSyxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRXBDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQ2xCLENBQUMsRUFDRCxPQUFPLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxZQUFZLEVBQ3JDLE9BQU8sQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLGFBQWEsQ0FDMUMsQ0FBQztJQUVGLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLFlBQVksR0FBRyxLQUFLLENBQUMsQ0FBQztJQUNyRCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDLENBQUM7SUFFdkQsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNoRCxNQUFNLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztJQUNyQixNQUFNLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztJQUV2QixNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRXBDLElBQUksQ0FBQyxHQUFHO1FBQ0osTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDO0lBRWxFLEdBQUcsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBRTFDLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxPQUFPLENBQU8sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFFckQsTUFBTSxDQUFDLE1BQU0sQ0FDVCxNQUFNLENBQUMsRUFBRTtZQUVMLElBQUksTUFBTTtnQkFDTixPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7O2dCQUVoQixNQUFNLENBQUMsSUFBSSxLQUFLLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxDQUFDO1FBQzlELENBQUMsRUFDRCxZQUFZLEVBQ1osT0FBTyxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQzFCLENBQUM7SUFDTixDQUFDLENBQUMsQ0FBQztJQUVILE9BQU87UUFDSCxJQUFJO1FBQ0osUUFBUSxFQUFFLFdBQVc7UUFDckIsS0FBSztRQUNMLE1BQU07S0FDVCxDQUFDO0FBQ04sQ0FBQztBQUVELEtBQUssVUFBVSxrQkFBa0IsQ0FDN0IsVUFBa0IsRUFDbEIsYUFBcUIsRUFDckIsT0FBZTtJQUdmLE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBRS9DLElBQUksR0FBRyxHQUFHLE1BQU0sS0FBSyxDQUNqQixvREFBb0QsR0FBRyxPQUFPLEVBQzlEO1FBQ0ksT0FBTyxFQUFFO1lBQ0wsTUFBTSxFQUFFLDZCQUE2QjtZQUNyQyxhQUFhLEVBQUUsU0FBUyxHQUFHLEtBQUs7WUFDaEMsc0JBQXNCLEVBQUUsWUFBWTtTQUN2QztRQUNELE1BQU0sRUFBRSxLQUFLO0tBQ2hCLENBQ0osQ0FBQztJQUVGLElBQUksR0FBRyxDQUFDO0lBRVIsSUFBSSxHQUFHLENBQUMsRUFBRTtRQUNOLEdBQUcsR0FBRyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDO1NBQzVCLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxHQUFHO1FBQ3ZCLE1BQU0sSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUV0QyxNQUFNLElBQUksR0FRTjtRQUNBLE9BQU87UUFDUCxTQUFTLEVBQUU7WUFDUCxJQUFJLEVBQUUsWUFBWSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUM7WUFDdkMsS0FBSyxFQUFFLFlBQVksQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDO1NBQzVDO1FBQ0QsT0FBTyxFQUFFLGFBQWE7UUFDdEIsR0FBRyxFQUFFLFNBQVM7S0FDakIsQ0FBQztJQUVGLElBQUksR0FBRztRQUNILElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDO0lBRW5CLEdBQUcsR0FBRyxNQUFNLEtBQUssQ0FDYixvREFBb0QsR0FBRyxPQUFPLEVBQzlEO1FBQ0ksT0FBTyxFQUFFO1lBQ0wsTUFBTSxFQUFFLDZCQUE2QjtZQUNyQyxhQUFhLEVBQUUsU0FBUyxHQUFHLEtBQUs7WUFDaEMsc0JBQXNCLEVBQUUsWUFBWTtTQUN2QztRQUNELE1BQU0sRUFBRSxLQUFLO1FBQ2IsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO0tBQzdCLENBQ0osQ0FBQztJQUVGLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRTtRQUNQLE1BQU0sSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUV0QyxPQUFPLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQztBQUN0QixDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsSUFBVTtJQUU1QixPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1FBRW5DLE1BQU0sTUFBTSxHQUFHLElBQUksVUFBVSxFQUFFLENBQUM7UUFFaEMsTUFBTSxDQUFDLE1BQU0sR0FBRyxHQUFHLEVBQUU7WUFFakIsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUM7WUFDL0MsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUVwQyxPQUFPLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQzFCLENBQUMsQ0FBQztRQUVGLE1BQU0sQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDO1FBQ3hCLE1BQU0sQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDL0IsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQsS0FBSyxVQUFVLGlCQUFpQixDQUFDLElBQVU7SUFFdkMsTUFBTSxJQUFJLEdBQUcsYUFBYSxFQUFFLENBQUM7SUFFN0IsSUFBSSxDQUFDLElBQUksRUFDVCxDQUFDO1FBQ0csV0FBVyxDQUFDLHVFQUF1RSxDQUFDLENBQUM7UUFDckYsT0FBTztJQUNYLENBQUM7SUFFRCxpRUFBaUU7SUFDakUsa0VBQWtFO0lBQ2xFLE1BQU0sU0FBUyxHQUFHLE1BQU0sWUFBWSxDQUFDLElBQUksRUFBRTtRQUN2QyxRQUFRLEVBQUUsSUFBSTtRQUNkLFNBQVMsRUFBRSxJQUFJO1FBQ2YsT0FBTyxFQUFFLElBQUk7S0FDaEIsQ0FBQyxDQUFDO0lBRUgsTUFBTSxhQUFhLEdBQUcsSUFBSSxJQUFJLENBQzFCLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxFQUNoQixHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsTUFBTSxFQUN4RDtRQUNJLElBQUksRUFBRSxZQUFZO1FBQ2xCLFlBQVksRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO0tBQzNCLENBQ0osQ0FBQztJQUVGLElBQUksZ0JBQWdCLEVBQUUsT0FBTztRQUN6QixHQUFHLENBQUMsZUFBZSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRWxELE1BQU0sT0FBTyxHQUFHLEdBQUcsQ0FBQyxlQUFlLENBQUMsYUFBYSxDQUFDLENBQUM7SUFFbkQsZ0JBQWdCLEdBQUc7UUFDZixJQUFJLEVBQUUsYUFBYTtRQUNuQixPQUFPO0tBQ1YsQ0FBQztJQUVGLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNyQixXQUFXLEVBQUUsQ0FBQztBQUNsQixDQUFDO0FBRUQsS0FBSyxVQUFVLG1CQUFtQixDQUFDLEtBQTZCO0lBRTVELE1BQU0sSUFBSSxHQUFHLGFBQWEsRUFBRSxDQUFDO0lBRTdCLElBQUksQ0FBQyxJQUFJLEVBQ1QsQ0FBQztRQUNHLFdBQVcsQ0FBQyxtRUFBbUUsQ0FBQyxDQUFDO1FBQ2pGLE9BQU87SUFDWCxDQUFDO0lBRUQsTUFBTSxjQUFjLEdBQVcsRUFBRSxDQUFDO0lBRWxDLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUN4QixDQUFDO1FBQ0csdURBQXVEO1FBQ3ZELHdDQUF3QztRQUN4QyxNQUFNLFNBQVMsR0FBRyxNQUFNLFlBQVksQ0FBQyxJQUFZLEVBQUU7WUFDL0MsUUFBUSxFQUFFLElBQUk7WUFDZCxTQUFTLEVBQUUsSUFBSTtZQUNmLE9BQU8sRUFBRSxJQUFJO1NBQ2hCLENBQUMsQ0FBQztRQUVILE1BQU0sWUFBWSxHQUNkLElBQUksWUFBWSxJQUFJO1lBQ2hCLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSTtZQUNYLENBQUMsQ0FBQyxPQUFPLENBQUM7UUFFbEIsY0FBYyxDQUFDLElBQUksQ0FDZixJQUFJLElBQUksQ0FDSixDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsRUFDaEIsR0FBRyxZQUFZLENBQUMsWUFBWSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsTUFBTSxFQUMzRDtZQUNJLElBQUksRUFBRSxZQUFZO1lBQ2xCLFlBQVksRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1NBQzNCLENBQ0osQ0FDSixDQUFDO0lBQ04sQ0FBQztJQUVELE1BQU0sUUFBUSxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FDdkMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FDNUIsQ0FBQztJQUVGLE1BQU0sY0FBYyxHQUNoQixLQUFLLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxDQUFDLE9BQU8sQ0FBQztRQUM5QixDQUFDLENBQUMsU0FBUyxFQUFFLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUM7UUFDckMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUViLGNBQWMsQ0FBQyxJQUFJLENBQUMsR0FBRyxRQUFRLENBQUMsQ0FBQztJQUVqQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxFQUFFO1FBRWhDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7SUFDNUQsQ0FBQyxDQUFDLENBQUM7SUFFSCxhQUFhLENBQUMsY0FBYyxDQUFDLENBQUM7SUFDOUIsV0FBVyxFQUFFLENBQUM7QUFDbEIsQ0FBQztBQUVELE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQW1CLGNBQWMsQ0FBQyxDQUFDO0FBQzVFLElBQUksVUFBVTtJQUNWLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLEVBQU8sRUFBRSxFQUFFO1FBRXBELE1BQU0sSUFBSSxHQUFTLEVBQUUsQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFeEMsSUFBSSxDQUFDLElBQUk7WUFDTCxPQUFPO1FBRVgsSUFDQSxDQUFDO1lBQ0csTUFBTSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNsQyxDQUFDO1FBQ0QsT0FBTyxLQUFVLEVBQ2pCLENBQUM7WUFDRyxXQUFXLENBQUMsS0FBSyxDQUFDLE9BQU8sSUFBSSxnREFBZ0QsQ0FBQyxDQUFDO1FBQ25GLENBQUM7UUFFRCxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssR0FBRyxFQUFFLENBQUM7SUFDekIsQ0FBQyxDQUFDLENBQUM7QUFFUCxNQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFtQixnQkFBZ0IsQ0FBQyxDQUFDO0FBQ2hGLElBQUksWUFBWTtJQUNaLFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLEVBQU8sRUFBRSxFQUFFO1FBRXRELE1BQU0sS0FBSyxHQUNQLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLENBQUM7UUFFdEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNO1lBQ2IsT0FBTztRQUVYLElBQ0EsQ0FBQztZQUNHLE1BQU0sbUJBQW1CLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDckMsQ0FBQztRQUNELE9BQU8sS0FBVSxFQUNqQixDQUFDO1lBQ0csV0FBVyxDQUFDLEtBQUssQ0FBQyxPQUFPLElBQUksMENBQTBDLENBQUMsQ0FBQztRQUM3RSxDQUFDO1FBRUQsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFDO0lBQ3pCLENBQUMsQ0FBQyxDQUFDO0FBRVAsVUFBVSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsa0JBQWtCO0lBRXZELFVBQVUsRUFBRSxLQUFLLEVBQUUsQ0FBQztBQUN4QixDQUFDLENBQUM7QUFFRixVQUFVLENBQUMsb0JBQW9CLEdBQUcsU0FBUyxvQkFBb0I7SUFFM0QsWUFBWSxFQUFFLEtBQUssRUFBRSxDQUFDO0FBQzFCLENBQUMsQ0FBQztBQUVGLFVBQVUsQ0FBQyxXQUFXLEdBQUcsU0FBUyxXQUFXO0lBRXpDLElBQUksZ0JBQWdCLEVBQUUsT0FBTztRQUN6QixHQUFHLENBQUMsZUFBZSxDQUFDLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRWxELGdCQUFnQixHQUFHLElBQUksQ0FBQztJQUN4QixXQUFXLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDaEIsV0FBVyxFQUFFLENBQUM7QUFDbEIsQ0FBQyxDQUFDO0FBRUYsT0FBTyxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsbUJBQW1CLENBQUUsRUFBRTtJQUNsRCxLQUFLLENBQUMsRUFBRTtRQUVKLFNBQVMsQ0FBQyxFQUFFLENBQUM7YUFDUixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQzthQUM1QixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztJQUNuQyxDQUFDO0NBQ0osQ0FDQSxDQUFDO0FBRUYsVUFBVSxDQUFDLFVBQVUsR0FBRyxVQUFVLE1BQWM7SUFFNUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUUsQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQztJQUN2RCxRQUFRLENBQUMsYUFBYSxDQUFtQix1QkFBdUIsQ0FBRSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDO0lBQzVGLFFBQVEsQ0FBQyxhQUFhLENBQWMsY0FBYyxDQUFFLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUM7SUFDNUUsUUFBUSxDQUFDLGFBQWEsQ0FBYyxpQkFBaUIsQ0FBRSxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDO0lBQ3BGLFFBQVEsQ0FBQyxhQUFhLENBQWMsaUJBQWlCLENBQUUsQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQztJQUNwRixRQUFRLENBQUMsYUFBYSxDQUFjLGlCQUFpQixDQUFFLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUM7SUFDcEYsUUFBUSxDQUFDLGFBQWEsQ0FBYyxtQkFBbUIsQ0FBRSxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQztJQUN4RixRQUFRLENBQUMsYUFBYSxDQUFtQixtQkFBbUIsQ0FBRSxDQUFDLEdBQUcsR0FBRyxNQUFNLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQztJQUMxRixNQUFNLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRTtRQUV6QixNQUFNLEVBQUUsR0FBRyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDOUIsRUFBRSxDQUFDLGFBQWEsQ0FBYyxXQUFXLENBQUUsQ0FBQyxTQUFTLEdBQUcsQ0FBQyxDQUFDLFFBQVEsQ0FBQztRQUNuRSxFQUFFLENBQUMsYUFBYSxDQUFjLE9BQU8sQ0FBRSxDQUFDLFNBQVMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDO1FBQzNELEVBQUUsQ0FBQyxhQUFhLENBQWMsVUFBVSxDQUFFLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUM7SUFDbEUsQ0FBQyxDQUFDLENBQUE7SUFDRixNQUFNLENBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRTtRQUU1QixNQUFNLEVBQUUsR0FBRyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDL0IsRUFBRSxDQUFDLGFBQWEsQ0FBYyxPQUFPLENBQUUsQ0FBQyxTQUFTLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQztRQUMzRCxFQUFFLENBQUMsYUFBYSxDQUFtQixLQUFLLENBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUMzRCxFQUFFLENBQUMsYUFBYSxDQUFvQixHQUFHLENBQUUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQztJQUMzRCxDQUFDLENBQUMsQ0FBQTtJQUVGLElBQUksT0FBTyxNQUFNLENBQUMsS0FBSyxLQUFLLFFBQVEsRUFDcEMsQ0FBQztRQUNHLDJDQUEyQztRQUMzQyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBQzdELENBQUM7U0FFRCxDQUFDO1FBQ0csTUFBTSxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUU7WUFFdEIsTUFBTSxFQUFFLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQzlCLEVBQUUsQ0FBQyxTQUFTLEdBQUcsQ0FBQyxDQUFDO1FBQ3JCLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELGdCQUFnQixHQUFHLElBQUksQ0FBQztJQUN4QixtQkFBbUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUM1QixhQUFhLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7SUFDcEYsV0FBVyxDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLENBQUM7SUFDaEMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBRTdCLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBYyxZQUFZLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUMsQ0FBQTtBQUN2RyxDQUFDLENBQUE7QUFFRCxJQUFJLE9BQU8sR0FBRyxFQUFFLENBQUM7QUFFakIsTUFBTSxNQUFNLEdBQVUsSUFBSSxLQUFLLENBQUM7SUFDNUIsSUFBSSxFQUFFLFFBQVE7SUFDZCxRQUFRLEVBQUU7UUFDTixDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSTtLQUMvQjtJQUNELGNBQWMsRUFBRTtRQUNaLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRTtZQUNwQixXQUFXLEVBQUUsQ0FBQyxPQUFPLEVBQUUsRUFBRTtnQkFFckIsT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsYUFBYSxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRTtvQkFDdEQsSUFBSSxFQUFFOzs7Ozs7O09BT25CO29CQUNhLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxLQUFLO29CQUNuQixLQUFLO3dCQUVELE9BQU8sT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUMzQixDQUFDO2lCQUNKLENBQUM7cUJBQ0csT0FBTyxDQUFDLE9BQU8sRUFBRTtvQkFDZCxJQUFJLEVBQUU7Ozs7Ozs7T0FPdkI7b0JBQ2lCLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxLQUFLO29CQUNuQixLQUFLO3dCQUVELE9BQU8sTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUMxQixDQUFDO2lCQUNKLENBQUMsQ0FBQztZQUNYLENBQUM7U0FDbUI7S0FDM0I7Q0FDSixDQUFDLENBQUM7QUFHSCxpRUFBaUU7QUFDakUsbUVBQW1FO0FBQ25FLE1BQU0sVUFBVSxPQUFPLENBQUMsS0FBWTtJQUVoQyxPQUFPLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUN2RSxDQUFDO0FBRUQsTUFBTSxVQUFVLE1BQU0sQ0FBQyxLQUFZO0lBRS9CLE9BQU8sQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3ZFLENBQUM7QUFDRCxNQUFNLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUE7QUFDdEMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLFFBQWEsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsRUFBRSxHQUFHLE9BQU8sR0FBRyxRQUFRLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbEgsTUFBTSxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7QUFFdEIsUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBYyxtQkFBbUIsQ0FBRSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7QUFDcEksS0FBSyxVQUFVLFNBQVMsQ0FBQyxFQUFTO0lBRTlCLE1BQU0sR0FBRyxHQUFHLE1BQU0sS0FBSyxDQUNuQixJQUFJLEdBQUcsQ0FDRixFQUFFLENBQUMsTUFBc0I7U0FDckIsU0FBUztTQUNULE9BQU8sQ0FDSixpQ0FBaUMsRUFDakMsdUNBQXVDLENBQzFDLEVBQ0wsSUFBSSxDQUNQLENBQ0osQ0FBQztJQUVGLE1BQU0sT0FBTyxHQUFHLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUMzQixNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRTVDLEtBQUssQ0FBQyxTQUFTLEdBQUcsTUFBTSxPQUFPLENBQUM7SUFFaEMsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FDM0IsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUM7U0FDckMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQ1IsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDLENBQ3hDO1NBQ0EsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDTixDQUFDLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUUsQ0FBQyxLQUFLO1FBQzVDLENBQUMsQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBRSxDQUFDLEtBQUs7S0FDOUMsQ0FBQyxDQUNULENBQUM7SUFFRixLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7SUFFZCxFQUFFLENBQUMsTUFBdUIsQ0FBQyxTQUFTO1FBQ2pDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUVwQixFQUFFLENBQUMsTUFBdUI7U0FDdEIsVUFBVztTQUNYLGFBQWEsQ0FBQyxLQUFLLENBQUU7U0FDckIsR0FBRyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUUzQixFQUFFLENBQUMsTUFBdUI7U0FDdEIsVUFBVztTQUNYLGFBQWEsQ0FBQyxHQUFHLENBQUU7U0FDbkIsSUFBSSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUMvQixDQUFDO0FBRUQsVUFBVSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7QUFFakMsTUFBTSxVQUFVLFNBQVM7SUFFckIsT0FBTztRQUNILEtBQUssRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBRSxDQUFDLFNBQVM7UUFDOUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtRQUNyQixPQUFPLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBbUIsdUJBQXVCLENBQUUsQ0FBQyxPQUFPO1FBQ25GLFFBQVEsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDdkUsUUFBUSxFQUFFLEVBQUUsQ0FBQyxhQUFhLENBQWMsV0FBVyxDQUFFLENBQUMsU0FBUztZQUMvRCxJQUFJLEVBQUUsRUFBRSxDQUFDLGFBQWEsQ0FBYyxPQUFPLENBQUUsQ0FBQyxTQUFTO1lBQ3ZELElBQUksRUFBRSxFQUFFLENBQUMsYUFBYSxDQUFjLFVBQVUsQ0FBRSxDQUFDLFNBQVM7U0FDN0QsQ0FBQyxDQUFDO1FBQ0gsV0FBVyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLHdCQUF3QixDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3RGLElBQUksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFjLE9BQU8sQ0FBRSxDQUFDLFNBQVM7WUFDekQsT0FBTyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQW1CLEtBQUssQ0FBRSxDQUFDLEdBQUc7WUFDekQsR0FBRyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQW9CLEdBQUcsQ0FBRSxDQUFDLElBQUk7U0FDeEQsQ0FBQyxDQUFDO1FBQ0gsS0FBSyxFQUFFLE9BQU8sSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBYyxXQUFXLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUM7UUFDekcsR0FBRyxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQWMsY0FBYyxDQUFFLENBQUMsU0FBUztRQUNuRSxRQUFRLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBYyxpQkFBaUIsQ0FBRSxDQUFDLFNBQVM7UUFDM0UsUUFBUSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQWMsaUJBQWlCLENBQUUsQ0FBQyxTQUFTO1FBQzNFLFFBQVEsRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFjLGlCQUFpQixDQUFFLENBQUMsU0FBUztRQUMzRSxLQUFLLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBbUIsY0FBYyxDQUFFLENBQUMsR0FBRztRQUNwRSxPQUFPLEVBQUUsYUFBYTtRQUN0QixJQUFJLEVBQUU7WUFDRixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBYyxhQUFhLENBQUUsQ0FBQyxTQUFTO1lBQ25FLE9BQU8sRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFtQixtQkFBbUIsQ0FBRSxDQUFDLEdBQUc7WUFDM0UsR0FBRyxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQW9CLGVBQWUsQ0FBRSxDQUFDLElBQUk7U0FDeEU7S0FDSixDQUFDO0FBQ04sQ0FBQztBQUVELEtBQUssVUFBVSxZQUFZLENBQUMsT0FBZTtJQUV2QyxNQUFNLFFBQVEsR0FBRyxNQUFNLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN0QyxNQUFNLElBQUksR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUVuQyxPQUFPLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUM5QixDQUFDO0FBRUQsTUFBTSxDQUFDLEtBQUssVUFBVSx5QkFBeUI7SUFFM0MsTUFBTSxNQUFNLEdBQUcsU0FBUyxFQUFFLENBQUM7SUFFM0IsK0JBQStCO0lBQy9CLElBQUksTUFBTSxDQUFDLEtBQUssSUFBSSxTQUFTLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQztRQUN2QyxNQUFNLENBQUMsS0FBSyxHQUFHLE1BQU0sWUFBWSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUVwRCxrQ0FBa0M7SUFDbEMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsRUFDakMsQ0FBQztRQUNHLE1BQU0sQ0FBQyxPQUFPLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUM5QixNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUMsR0FBRyxFQUFDLEVBQUU7WUFFM0IsSUFBSSxHQUFHLElBQUksU0FBUyxDQUFDLEdBQUcsQ0FBQztnQkFDckIsT0FBTyxNQUFNLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUVuQyxPQUFPLEdBQUcsQ0FBQztRQUNmLENBQUMsQ0FBQyxDQUNMLENBQUM7SUFDTixDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDbEIsQ0FBQztBQUVELFNBQVMsV0FBVztJQUVoQix5QkFBeUIsRUFBRTtTQUN0QixJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7QUFDeEQsQ0FBQztBQUVELEtBQUssVUFBVSxtQkFBbUIsQ0FBQyxNQUFjO0lBRTdDLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksYUFBYSxFQUFFLENBQUM7SUFFNUMsSUFBSSxDQUFDLElBQUk7UUFDTCxNQUFNLElBQUksS0FBSyxDQUFDLHlEQUF5RCxDQUFDLENBQUM7SUFFL0UsSUFBSSxZQUFZLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQztJQUVoQyxJQUFJLFNBQVMsQ0FBQyxZQUFZLENBQUMsRUFDM0IsQ0FBQztRQUNHLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxJQUFJO1lBQ3ZCLE1BQU0sSUFBSSxLQUFLLENBQUMsK0RBQStELENBQUMsQ0FBQztRQUVyRixNQUFNLFFBQVEsR0FBRyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxZQUFZLENBQUMsQ0FBQztRQUMxRSxNQUFNLFVBQVUsR0FBRyxvQkFBb0IsSUFBSSxVQUFVLFFBQVEsRUFBRSxDQUFDO1FBQ2hFLE1BQU0sTUFBTSxHQUFHLE1BQU0sWUFBWSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3pELE1BQU0sa0JBQWtCLENBQUMsVUFBVSxHQUFHLFVBQVUsRUFBRSxNQUFNLEVBQUUsU0FBUyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQzNFLFlBQVksR0FBRyxVQUFVLENBQUM7UUFFMUIsV0FBVyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRTFCLElBQUksZ0JBQWdCLEVBQUUsT0FBTztZQUN6QixHQUFHLENBQUMsZUFBZSxDQUNmLGdCQUFnQixDQUFDLE9BQU8sQ0FDM0IsQ0FBQztRQUVOLGdCQUFnQixHQUFHLElBQUksQ0FBQztJQUM1QixDQUFDO0lBRUQsTUFBTSxjQUFjLEdBQUcsRUFBRSxDQUFDO0lBQzFCLE1BQU0sYUFBYSxHQUNmLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQztRQUN6QixDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU87UUFDaEIsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUViLEtBQUssTUFBTSxHQUFHLElBQUksYUFBYSxFQUMvQixDQUFDO1FBQ0csSUFBSSxDQUFDLEdBQUc7WUFDSixTQUFTO1FBRWIsSUFBSSxTQUFTLENBQUMsR0FBRyxDQUFDLEVBQ2xCLENBQUM7WUFDRyxNQUFNLElBQUksR0FBRyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7WUFFMUMsSUFBSSxDQUFDLElBQUk7Z0JBQ0wsTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFDO1lBRWpGLE1BQU0sUUFBUSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLE9BQU8sQ0FBQyxDQUFDO1lBQ3BELE1BQU0sVUFBVSxHQUFHLFdBQVcsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNqRyxNQUFNLFVBQVUsR0FBRywyQkFBMkIsSUFBSSxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ25FLE1BQU0sTUFBTSxHQUFHLE1BQU0sWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3hDLE1BQU0sa0JBQWtCLENBQUMsVUFBVSxFQUFFLE1BQU0sRUFBRSxXQUFXLElBQUksRUFBRSxDQUFDLENBQUM7WUFDaEUsY0FBYyxDQUFDLElBQUksQ0FBQyxvQkFBb0IsSUFBSSxJQUFJLFVBQVUsRUFBRSxDQUFDLENBQUM7WUFDOUQsbUJBQW1CLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3BDLENBQUM7YUFFRCxDQUFDO1lBQ0csY0FBYyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUM3QixDQUFDO0lBQ0wsQ0FBQztJQUVELGFBQWEsR0FBRyxjQUFjLENBQUM7SUFDL0IsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBRTdCLE9BQU8sRUFBRSxHQUFHLE1BQU0sRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsQ0FBQztBQUN2RSxDQUFDO0FBRUQsVUFBVSxDQUFDLFdBQVcsR0FBRyxLQUFLLFVBQVUsV0FBVztJQUUvQyxNQUFNLE1BQU0sR0FBRyxTQUFTLEVBQUUsQ0FBQztJQUUzQixVQUFVLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBRS9CLE1BQU0sUUFBUSxHQUNWLEdBQUcsR0FBRyxhQUFhLE1BQU0sQ0FBQyxLQUFLO1NBQzFCLFNBQVMsQ0FBQyxLQUFLLENBQUM7U0FDaEIsT0FBTyxDQUFDLGtCQUFrQixFQUFFLEVBQUUsQ0FBQztTQUMvQixPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQztTQUNuQixXQUFXLEVBQUUsT0FBTyxDQUFDO0lBRTlCLElBQUksR0FBRyxHQUFHLE1BQU0sS0FBSyxDQUNqQixvREFBb0Q7UUFDcEQsUUFBUSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxFQUNsQztRQUNJLE9BQU8sRUFBRTtZQUNMLE1BQU0sRUFBRSw2QkFBNkI7WUFDckMsYUFBYSxFQUFFLFNBQVMsR0FBRyxLQUFLO1lBQ2hDLHNCQUFzQixFQUFFLFlBQVk7U0FDdkM7UUFDRCxNQUFNLEVBQUUsS0FBSztLQUNoQixDQUNKLENBQUM7SUFFRixHQUFHLEdBQUcsTUFBTSxLQUFLLENBQ2Isb0RBQW9EO1FBQ3BELFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsRUFDbEM7UUFDSSxPQUFPLEVBQUU7WUFDTCxNQUFNLEVBQUUsNkJBQTZCO1lBQ3JDLGFBQWEsRUFBRSxTQUFTLEdBQUcsS0FBSztZQUNoQyxzQkFBc0IsRUFBRSxZQUFZO1NBQ3ZDO1FBQ0QsTUFBTSxFQUFFLFFBQVE7UUFDaEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDakIsT0FBTyxFQUFFLFNBQVMsR0FBRyxNQUFNLENBQUMsS0FBSztZQUNqQyxTQUFTLEVBQUU7Z0JBQ1AsSUFBSSxFQUFFLFlBQVksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDO2dCQUN2QyxLQUFLLEVBQUUsWUFBWSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUM7YUFDNUM7WUFDRCxHQUFHLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEdBQUc7U0FDOUIsQ0FBQztLQUNMLENBQ0osQ0FBQztJQUVGLFFBQVEsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQztBQUN4QyxDQUFDLENBQUM7QUFFRixVQUFVLENBQUMsSUFBSSxHQUFHLEtBQUssVUFBVSxJQUFJO0lBRWpDLFFBQVEsQ0FBQyxhQUFhLENBQ2xCLFVBQVUsQ0FDWixDQUFDLEtBQUssQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDO0lBRTFCLElBQUksTUFBTSxHQUFHLFNBQVMsRUFBRSxDQUFDO0lBRXpCLElBQ0EsQ0FBQztRQUNHLE1BQU0sR0FBRyxNQUFNLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQy9DLENBQUM7SUFDRCxPQUFPLEtBQVUsRUFDakIsQ0FBQztRQUNHLFdBQVcsQ0FBQyxLQUFLLENBQUMsT0FBTyxJQUFJLDBDQUEwQyxDQUFDLENBQUM7UUFDekUsT0FBTyxRQUFRLENBQUMsYUFBYSxDQUFjLFVBQVUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUM7UUFDckUsT0FBTztJQUNYLENBQUM7SUFFRCxNQUFNLFFBQVEsR0FDVixHQUFHLEdBQUcsYUFBYSxNQUFNLENBQUMsS0FBSztTQUMxQixTQUFTLENBQUMsS0FBSyxDQUFDO1NBQ2hCLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUM7U0FDL0IsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUM7U0FDbkIsV0FBVyxFQUFFLE9BQU8sQ0FBQztJQUU5QixJQUFJLEdBQUcsR0FBRyxNQUFNLEtBQUssQ0FDakIsb0RBQW9EO1FBQ3BELFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsRUFDbEM7UUFDSSxPQUFPLEVBQUU7WUFDTCxNQUFNLEVBQUUsNkJBQTZCO1lBQ3JDLGFBQWEsRUFBRSxTQUFTLEdBQUcsS0FBSztZQUNoQyxzQkFBc0IsRUFBRSxZQUFZO1NBQ3ZDO1FBQ0QsTUFBTSxFQUFFLEtBQUs7S0FDaEIsQ0FDSixDQUFDO0lBRUYsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sSUFBSSxHQUFHLENBQUM7SUFFakMsSUFBSSxNQUFNLEVBQ1YsQ0FBQztRQUNHLEdBQUcsR0FBRyxNQUFNLEtBQUssQ0FDYixvREFBb0Q7WUFDcEQsUUFBUSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxFQUNsQztZQUNJLE9BQU8sRUFBRTtnQkFDTCxNQUFNLEVBQUUsNkJBQTZCO2dCQUNyQyxhQUFhLEVBQUUsU0FBUyxHQUFHLEtBQUs7Z0JBQ2hDLHNCQUFzQixFQUFFLFlBQVk7YUFDdkM7WUFDRCxNQUFNLEVBQUUsS0FBSztZQUNiLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNqQixPQUFPLEVBQUUsU0FBUyxHQUFHLE1BQU0sQ0FBQyxLQUFLO2dCQUNqQyxTQUFTLEVBQUU7b0JBQ1AsSUFBSSxFQUFFLFlBQVksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDO29CQUN2QyxLQUFLLEVBQUUsWUFBWSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUM7aUJBQzVDO2dCQUNELE9BQU8sRUFBRSxJQUFJLENBQ1QsUUFBUSxDQUNKLGtCQUFrQixDQUNkLElBQUksQ0FBQyxTQUFTLENBQ1YsTUFBTSxFQUNOLElBQUksRUFDSixDQUFDLENBQ0osQ0FDSixDQUNKLENBQ0o7YUFDSixDQUFDO1NBQ0wsQ0FDSixDQUFDO0lBQ04sQ0FBQztTQUVELENBQUM7UUFDRyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFDWCxDQUFDO1lBQ0csSUFBSSxDQUFDLElBQUksQ0FBQztnQkFDTixLQUFLLEVBQUUsa0NBQWtDO2dCQUN6QyxJQUFJLEVBQUUsTUFBTSxHQUFHLENBQUMsSUFBSSxFQUFFO2FBQ3pCLENBQUMsQ0FBQztZQUVILE9BQU87UUFDWCxDQUFDO1FBRUQsR0FBRyxHQUFHLE1BQU0sS0FBSyxDQUNiLG9EQUFvRDtZQUNwRCxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLEVBQ2xDO1lBQ0ksT0FBTyxFQUFFO2dCQUNMLE1BQU0sRUFBRSw2QkFBNkI7Z0JBQ3JDLGFBQWEsRUFBRSxTQUFTLEdBQUcsS0FBSztnQkFDaEMsc0JBQXNCLEVBQUUsWUFBWTthQUN2QztZQUNELE1BQU0sRUFBRSxLQUFLO1lBQ2IsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ2pCLE9BQU8sRUFBRSxTQUFTLEdBQUcsTUFBTSxDQUFDLEtBQUs7Z0JBQ2pDLFNBQVMsRUFBRTtvQkFDUCxJQUFJLEVBQUUsWUFBWSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUM7b0JBQ3ZDLEtBQUssRUFBRSxZQUFZLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQztpQkFDNUM7Z0JBQ0QsR0FBRyxFQUFFLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHO2dCQUMzQixPQUFPLEVBQUUsSUFBSSxDQUNULFFBQVEsQ0FDSixrQkFBa0IsQ0FDZCxJQUFJLENBQUMsU0FBUyxDQUNWLE1BQU0sRUFDTixJQUFJLEVBQ0osQ0FBQyxDQUNKLENBQ0osQ0FDSixDQUNKO2FBQ0osQ0FBQztTQUNMLENBQ0osQ0FBQztJQUNOLENBQUM7SUFFRCxJQUFJLEdBQUcsQ0FBQyxFQUFFLEVBQ1YsQ0FBQztRQUNHLElBQUksTUFBTSxFQUNWLENBQUM7WUFDRyxVQUFVLENBQUMsV0FBVyxDQUFDO2dCQUNuQixHQUFHLE1BQU07Z0JBQ1QsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osS0FBSyxFQUFFLEVBQUU7Z0JBQ1QsS0FBSyxFQUFFLEVBQUU7YUFDWixDQUFDLENBQUM7WUFFSCxJQUFJLGFBQWEsQ0FBQztZQUVsQixJQUFJLENBQUMsSUFBSSxDQUFDO2dCQUNOLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLElBQUksRUFBRSxvREFBb0Q7Z0JBQzFELGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLElBQUksRUFBRSxTQUFTO2dCQUNmLEtBQUssRUFBRSxLQUFLO2dCQUVaLE9BQU8sRUFBRSxHQUFHLEVBQUU7b0JBRVYsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO29CQUVuQixNQUFNLEtBQUssR0FDUCxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUV2QyxhQUFhLEdBQUcsV0FBVyxDQUFDLEdBQUcsRUFBRTt3QkFFN0IsS0FBSyxDQUFDLFdBQVc7NEJBQ2IsR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLEdBQUcsSUFBSSxFQUFFLENBQUM7b0JBQ3hDLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQztnQkFDYixDQUFDO2dCQUVELFNBQVMsRUFBRSxHQUFHLEVBQUU7b0JBRVosYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDO29CQUU3QixRQUFRLENBQUMsT0FBTyxDQUNaLFFBQVE7eUJBQ0gsU0FBUyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7eUJBQ3JCLE9BQU8sQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQzdCLENBQUM7Z0JBQ04sQ0FBQzthQUNKLENBQUMsQ0FBQztRQUNQLENBQUM7YUFFRCxDQUFDO1lBQ0csVUFBVSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUU3QixJQUFJLENBQUMsSUFBSSxDQUFDO2dCQUNOLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLEtBQUssRUFBRSxLQUFLO2dCQUNaLGdCQUFnQixFQUFFLElBQUk7Z0JBQ3RCLElBQUksRUFBRSxTQUFTO2dCQUVmLFNBQVMsRUFBRSxHQUFHLEVBQUU7b0JBRVosT0FBTyxRQUFRLENBQUMsYUFBYSxDQUFjLFVBQVUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUM7Z0JBQ3pFLENBQUM7YUFDSixDQUFDLENBQUM7UUFDUCxDQUFDO1FBRUQsSUFBSSxjQUFjLElBQUksVUFBVSxFQUNoQyxDQUFDO1lBQ0csTUFBTSxLQUFLLEdBQUcsTUFBTSxZQUFZLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUNyRCxJQUFJLEtBQUssSUFBSSxTQUFTO2dCQUNsQixJQUFJLFlBQVksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBQ2hELENBQUM7SUFDTCxDQUFDO1NBRUQsQ0FBQztRQUNHLElBQUksQ0FBQyxJQUFJLENBQUM7WUFDTixLQUFLLEVBQUUsNEJBQTRCO1lBQ25DLEtBQUssRUFBRSxLQUFLO1lBQ1osZ0JBQWdCLEVBQUUsSUFBSTtZQUN0QixJQUFJLEVBQUUsT0FBTztZQUNiLElBQUksRUFBRSxNQUFNLEdBQUcsQ0FBQyxJQUFJLEVBQUU7U0FDekIsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztBQUNMLENBQUMsQ0FBQztBQUVGLFNBQVMsWUFBWSxDQUFDLEtBQUs7SUFFdkIsTUFBTSxFQUFFLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN4QyxFQUFFLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUV6QixNQUFNLENBQUMsR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3RDLENBQUMsQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFDO0lBQ3BCLEVBQUUsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFbEIsTUFBTSxHQUFHLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMxQyxDQUFDLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRW5CLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDNUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDM0IsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUF5QixDQUFDO0lBQ2pELEVBQUUsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDckIsUUFBUSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUMxRCxPQUFPLENBQUMsSUFBSSxFQUFFO1FBQ1YsS0FBSyxFQUFFLENBQUMsRUFBbUMsRUFBRSxFQUFFO1lBRTNDLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxTQUFTLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsU0FBUyxLQUFLLElBQUk7Z0JBQzFELFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO2lCQUV6RSxDQUFDO2dCQUNHLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDWixXQUFXLEVBQUUsQ0FBQztZQUNsQixDQUFDO1FBQ0wsQ0FBQztLQUNKLENBQUMsQ0FBQztJQUVILElBQUksS0FBSztRQUNMLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUVqQixPQUFPLEVBQUUsQ0FBQztBQUNkLENBQUM7QUFFRCxVQUFVLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQztBQUV2QyxTQUFTLFdBQVcsQ0FBQyxLQUFLO0lBRXRCLE1BQU0sRUFBRSxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUM7SUFFeEMsRUFBRSxDQUFDLGVBQWU7UUFDZCxJQUF5QixDQUFDO0lBRTlCLFFBQVE7U0FDSCxhQUFhLENBQUMsV0FBVyxDQUFDO1NBQzFCLFdBQVcsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUVyQixPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7SUFFWixJQUFJLEtBQUs7UUFDTCxFQUFFLENBQUMsS0FBSyxFQUFFLENBQUM7SUFFZixFQUFFLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQyxDQUFDO0lBRXpDLE9BQU8sRUFBRSxDQUFDO0FBQ2QsQ0FBQztBQUVELFVBQVUsQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFDO0FBRXJDLFNBQVMsV0FBVyxDQUFDLEtBQUs7SUFFdEIsTUFBTSxFQUFFLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUV4QyxNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2hELE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDNUMsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUUvQyxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUNuQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUMzQixPQUFPLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNqQyxRQUFRLENBQUMsZUFBZSxHQUFHLElBQXlCLENBQUM7SUFDckQsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUF5QixDQUFDO0lBQ2pELE9BQU8sQ0FBQyxlQUFlLEdBQUcsSUFBeUIsQ0FBQztJQUNwRCxFQUFFLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3pCLEVBQUUsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDckIsRUFBRSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN4Qiw2QkFBNkI7SUFDN0IsUUFBUSxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDdkQsT0FBTyxDQUFDLFFBQVEsRUFBRSxFQUFFLEtBQUssQ0FBQyxFQUFFLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUMsT0FBTyxLQUFLLENBQUEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQ3BGLE9BQU8sQ0FBQyxJQUFJLEVBQUUsRUFBRSxLQUFLLENBQUMsRUFBRSxJQUFJLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFDLE9BQU8sS0FBSyxDQUFBLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtJQUNuRixPQUFPLENBQUMsT0FBTyxFQUFFLEVBQUUsS0FBSyxDQUFDLEVBQUUsSUFBSSxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQyxPQUFPLEtBQUssQ0FBQSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDM0gsSUFBSSxLQUFLO1FBQ0wsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO0lBRXJCLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFDL0MsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxXQUFXLENBQUMsQ0FBQztJQUMzQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLFdBQVcsQ0FBQyxDQUFDO0lBRTlDLE9BQU8sRUFBRSxDQUFDO0FBQ2QsQ0FBQztBQUVELFVBQVUsQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFDO0FBRXJDLFNBQVMsT0FBTyxDQUFDLElBQWlCLEVBQUUsSUFBNEU7SUFFNUcsSUFBSSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBRS9CLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLEVBQUUsVUFBVSxFQUFFO1FBRXpDLElBQ0ksSUFBSSxDQUFDLFNBQVMsS0FBSyxFQUFFO1lBQ3JCLENBQ0ksRUFBRSxDQUFDLEdBQUcsSUFBSSxRQUFRO2dCQUNsQixFQUFFLENBQUMsR0FBRyxJQUFJLFdBQVc7Z0JBQ3JCLEVBQUUsQ0FBQyxHQUFHLElBQUksUUFBUSxDQUNyQixFQUVMLENBQUM7WUFDRyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDaEIsQ0FBQzthQUNJLElBQUksRUFBRSxDQUFDLEdBQUcsSUFBSSxJQUFJO1lBQ25CLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBUyxDQUFDLENBQUM7SUFDaEMsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFO1FBRTFCLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQztRQUVkLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxPQUFPLEtBQUssSUFBSTtZQUM1QixFQUFFLEdBQUcsRUFBRSxDQUFDLGFBQWEsQ0FBQztRQUUxQixJQUFJLEVBQUUsRUFBRSxXQUFXLElBQUksRUFBRSxFQUN6QixDQUFDO1lBQ0csRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ1osV0FBVyxFQUFFLENBQUM7UUFDbEIsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQyJ9