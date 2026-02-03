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
    return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ +/g, '-').toLowerCase();
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
    images = Array.isArray(images) ? images : [];
    galleryGridEl.innerHTML = '';
    images.forEach((url, index) => {
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
            removeBtn.innerText = 'Supprimer';
            removeBtn.addEventListener('click', () => {
                if (isBlobUrl(url))
                    pendingGalleryFiles.delete(url);
                images.splice(index, 1);
                renderGallery(images);
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
function saveLocally() { globalThis.saveLocally(getRecipe()); }
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