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
    return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ ’]+/g, '-').toLowerCase();
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
        Swal.fire({ title: 'Erreur', text: message, icon: 'error' });
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
                    coverImageUrl = 'https://github.com/npenin/anne/blob/master' + coverImageUrl + '?raw=true';
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
                if (isBlobUrl(url))
                    pendingGalleryFiles.delete(url);
                galleryImages.splice(index, 1);
                renderGallery(galleryImages);
                saveLocally();
            });
            figure.appendChild(removeBtn);
        }
        galleryGridEl.appendChild(figure);
    });
}
async function uploadFileToGithub(pathInRepo, contentBase64, message) {
    const apiPath = pathInRepo.replace(/^\/+/, '');
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + apiPath, {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' },
        method: 'GET'
    });
    let sha;
    if (res.ok)
        sha = (await res.json()).sha;
    else if (res.status !== 404)
        throw new Error(await res.text());
    const body = {
        message,
        committer: { name: localStorage.getItem('user.name'), email: localStorage.getItem('user.email') },
        content: contentBase64,
        sha: undefined
    };
    if (sha)
        body.sha = sha;
    res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + apiPath, {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' },
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
    // Create blob URL for immediate display
    if (pendingCoverFile?.blobUrl)
        URL.revokeObjectURL(pendingCoverFile.blobUrl);
    const blobUrl = URL.createObjectURL(file);
    pendingCoverFile = { file, blobUrl };
    renderCover(blobUrl);
    saveLocally();
}
async function handleGalleryUpload(files) {
    const slug = getRecipeSlug();
    if (!slug) {
        notifyError('Renseignez le titre de la recette avant de téléverser des photos.');
        return;
    }
    // Create blob URLs for immediate display
    const blobUrls = Array.from(files).map(file => URL.createObjectURL(file));
    const currentGallery = Array.isArray(getRecipe().gallery) ? getRecipe().gallery.filter(Boolean) : [];
    currentGallery.push(...blobUrls);
    blobUrls.forEach((blobUrl, index) => {
        pendingGalleryFiles.set(blobUrl, files[index]);
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
        fetchmold(ev).then(() => ev.target.blur()).then(() => saveLocally());
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
    root: '#steps', features: {
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
                }).addItem('right', {
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
    const res = await fetch(new URL(ev.target.innerText.replace('https://boutique.guydemarle.com', 'https://d2quloop9d8ihx.cloudfront.net'), root));
    const content = res.text();
    const dummy = document.createElement('div');
    dummy.innerHTML = await content;
    const meta = Object.fromEntries(Array.from(dummy.querySelectorAll('meta').values()).filter(v => v.attributes.getNamedItem('property')).map(v => [v.attributes.getNamedItem('property').value, v.attributes.getNamedItem('content').value]));
    dummy.remove();
    ev.target.innerText = meta['og:title'];
    ev.target.parentNode.querySelector('img').src = meta['og:image'];
    ev.target.parentNode.querySelector('a').href = meta['og:url'];
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
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
export async function getRecipeWithBase64Images() {
    const recipe = getRecipe();
    // Convert cover blob to base64
    if (recipe.cover && isBlobUrl(recipe.cover)) {
        recipe.cover = await blobToBase64(recipe.cover);
    }
    // Convert gallery blobs to base64
    if (Array.isArray(recipe.gallery)) {
        recipe.gallery = await Promise.all(recipe.gallery.map(async (url) => {
            if (url && isBlobUrl(url)) {
                return await blobToBase64(url);
            }
            return url;
        }));
    }
    return recipe;
}
function saveLocally() {
    getRecipeWithBase64Images().then(recipe => globalThis.saveLocally(recipe));
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
    const sourceGallery = Array.isArray(recipe.gallery) ? recipe.gallery : [];
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
    const filename = `${dir}/recettes/${recipe.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ +/g, '-').toLowerCase()}.json`;
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'GET'
    });
    // console.log((await res.json()).sha);
    res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'DELETE', body: JSON.stringify({ "message": "delete " + recipe.title, "committer": { "name": localStorage.getItem('user.name'), "email": localStorage.getItem('user.email') }, sha: (await res.json()).sha })
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
    const filename = `${dir}/recettes/${recipe.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ +/g, '-').toLowerCase()}.json`;
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'GET'
    });
    const create = res.status == 404;
    if (create) {
        res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
            headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'PUT', body: JSON.stringify({ "message": "create " + recipe.title, "committer": { "name": localStorage.getItem('user.name'), "email": localStorage.getItem('user.email') }, "content": btoa(unescape(encodeURIComponent(JSON.stringify(recipe, null, 4)))) })
        });
    }
    else {
        if (!res.ok) {
            Swal.fire({ title: 'Probleme lors de la recuperation', text: await res.text() });
            return;
        }
        res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
            headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'PUT', body: JSON.stringify({ "message": "update " + recipe.title, "committer": { "name": localStorage.getItem('user.name'), "email": localStorage.getItem('user.email') }, sha: (await res.json()).sha, "content": btoa(unescape(encodeURIComponent(JSON.stringify(recipe, null, 4)))) })
        });
    }
    if (res.ok) {
        if (create) {
            globalThis.saveLocally({ ...recipe, toppings: [], steps: [], title: '' });
            let timerInterval;
            Swal.fire({
                title: "Recette enregistrée !",
                html: "Redirection vers la recette créée dans <b></b>s...",
                timerProgressBar: true,
                icon: "success",
                timer: 30000,
                didOpen: () => {
                    Swal.showLoading();
                    const timer = Swal.getPopup().querySelector("b");
                    timerInterval = setInterval(() => {
                        timer.textContent = `${Swal.getTimerLeft() / 1000}`;
                    }, 1000);
                },
                willClose: () => {
                    clearInterval(timerInterval);
                    location.replace(filename.substring(dir.length).replace('.json', '/'));
                }
            });
        }
        else {
            globalThis.saveLocally(null);
            Swal.fire({
                title: "Recette enregistrée !",
                timer: 10000,
                timerProgressBar: true,
                icon: "success",
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
            title: "Une erreur s\'est produite",
            timer: 10000,
            timerProgressBar: true,
            icon: "error",
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
    li.contentEditable = true;
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
        if (self.innerText === '' && (ev.key == 'Delete' || ev.key == 'Backspace' || ev.key == 'Escape')) {
            self.blur();
        }
        //else if (this.innerText === '' && ev.key.length > 1 && ev.key !== 'Unidentified')
        //    self.innerText = ev.key;
        else if (ev.key in keys)
            keys[ev.key](ev);
    });
    self.addEventListener('blur', function (ev) {
        let li = self;
        while (li && li.tagName !== 'LI')
            li = li.parentElement;
        if (li?.textContent == '') {
            li.remove();
            saveLocally();
        }
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyaXB0Lm1qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmlwdC5tdHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsTUFBTSxnQkFBZ0IsQ0FBQztBQTJCM0gsSUFBSSxLQUFLLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUNqRCxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNwQyxZQUFZLENBQUMsT0FBTyxDQUFDLGNBQWMsRUFBRSxLQUFLLENBQUMsQ0FBQTtBQUMvQyxJQUFJLFFBQVEsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBQ2pELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzlDLFlBQVksQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLFFBQVEsQ0FBQyxDQUFBO0FBQy9DLElBQUksUUFBUSxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDbEQsSUFBSSxDQUFDLFFBQVEsSUFBSSxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDOUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsUUFBUSxDQUFDLENBQUE7QUFFaEQsTUFBTSxHQUFHLEdBQUcsNEJBQTRCLENBQUE7QUFDeEMsTUFBTSxJQUFJLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsY0FBYyxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUMsTUFB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