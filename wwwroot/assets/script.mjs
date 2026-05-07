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
        mde.value(recipe.steps);
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
const mde = new globalThis.SimpleMDE({ spellChecer: false, element: document.querySelector('#steps>textarea') });
mde.codemirror.on('changes', () => saveLocally());
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
        steps: mde.value() || Array.from(document.querySelectorAll('.steps li')).map(li => li.innerText),
        for: document.querySelector('.info .count').innerText,
        preptime: document.querySelector('.info .preptime').innerText,
        resttime: document.querySelector('.info .resttime').innerText,
        cooktime: document.querySelector('.info .cooktime').innerText,
        cover: document.querySelector('.cover-image').dataset.hasImage == 'true' ? document.querySelector('.cover-image').src : undefined,
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
        await uploadFileToGithub(targetPath, base64, `cover ${slug}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyaXB0Lm1qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmlwdC5tdHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBc0JBLElBQUksS0FBSyxHQUFHLFlBQVksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUM7QUFDakQsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDcEMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDLENBQUE7QUFDL0MsSUFBSSxRQUFRLEdBQUcsWUFBWSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUNqRCxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUM5QyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxRQUFRLENBQUMsQ0FBQTtBQUMvQyxJQUFJLFFBQVEsR0FBRyxZQUFZLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQ2xELElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzlDLFlBQVksQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFBO0FBRWhELE1BQU0sR0FBRyxHQUFHLDRCQUE0QixDQUFBO0FBQ3hDLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLGNBQWMsQ0FBQyxNQUFNLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBRS9ILE1BQU0sWUFBWSxDQUFDLGlCQUFpQixFQUFFLENBQUM7QUFFdkMsTUFBTSxZQUFZLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBbUIsY0FBYyxDQUFDLENBQUM7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