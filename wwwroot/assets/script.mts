declare global
{
    export function saveLocally(recipe: Recipe): void;
    export const Swal: any;
}

type Recipe = {
    title: string;
    slug: string;
    private: boolean;
    toppings: { quantity: string; unit: string; name: string }[];
    accessories: { name: string; picture: string; url: string }[];
    steps: string[] | string;
    for: string;
    preptime: string;
    resttime: string;
    cooktime: string;
    cover?: string;
    gallery?: string[];
    mold: { name: string; picture: string; url: string };
}

let token = localStorage.getItem('GITHUB_TOKEN');
if (!token && (token = prompt('Token?')))
    localStorage.setItem('GITHUB_TOKEN', token)
let username = localStorage.getItem('user.name');
if (!username && (username = prompt('user name?')))
    localStorage.setItem('user.name', username)
let usermail = localStorage.getItem('user.email');
if (!usermail && (usermail = prompt('user.email')))
    localStorage.setItem('user.email', usermail)

const dir = "/{{recette.title|slugify}}"
const root = globalThis.location.href.substring(0, globalThis.location.href.length - '{{page.url}}'.length + '/admin/'.length);

await Notification.requestPermission();

const coverImageEl = document.querySelector<HTMLImageElement>('.cover-image');
const galleryGridEl = document.querySelector('.gallery-grid');
const isGalleryEditor = !!document.querySelector('.gallery-editor');
let galleryImages = [];
let pendingCoverFile = null;
const pendingGalleryFiles = new Map();

function isBlobUrl(url)
{
    return typeof url === 'string' && url.startsWith('blob:');
}

function slugifyTitle(title)
{
    return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ +/g, '-').toLowerCase();
}

function getRecipeSlug()
{
    const title = document.querySelector('h1')?.innerText?.trim();
    if (!title)
        return '';
    return slugifyTitle(title);
}

function safeFilename(name)
{
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

function notifyError(message)
{
    if (Swal?.fire)
        Swal.fire({ title: 'Erreur', text: message, icon: 'error' });
    else
        alert(message);
}

function renderCover(coverImageUrl)
{
    if (!coverImageEl)
        return;
    if (coverImageUrl)
    {
        if (window.location.hostname == 'localhost' && coverImageUrl.startsWith('/assets/'))
            fetch(coverImageUrl, { method: 'HEAD' }).then(res =>
            {
                if (!res.ok)
                    coverImageUrl = 'https://github.com/npenin/anne/blob/master' + coverImageUrl + '?raw=true';
                coverImageEl.src = coverImageUrl;
            });
        else
            coverImageEl.src = coverImageUrl;
    }
    else
    {
        coverImageEl.removeAttribute('src');
    }
}

function renderGallery(images)
{
    if (!galleryGridEl)
        return;
    images = Array.isArray(images) ? images : [];
    galleryGridEl.innerHTML = '';
    images.forEach((url, index) =>
    {
        const figure = document.createElement('figure');
        const img = document.createElement('img');
        img.src = url;
        img.loading = 'lazy';
        img.alt = 'Photo de la recette';
        figure.appendChild(img);

        if (isGalleryEditor)
        {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.classList.add('remove-photo');
            removeBtn.innerText = 'Supprimer';
            removeBtn.addEventListener('click', () =>
            {
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

async function uploadFileToGithub(pathInRepo, contentBase64, message)
{
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

function fileToBase64(file)
{
    return new Promise((resolve, reject) =>
    {
        const reader = new FileReader();
        reader.onload = () =>
        {
            const result = reader.result?.toString() || '';
            const base64 = result.split(',')[1];
            resolve(base64 || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handleCoverUpload(file)
{
    const slug = getRecipeSlug();
    if (!slug)
    {
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

async function handleGalleryUpload(files: (Blob | MediaSource)[])
{
    const slug = getRecipeSlug();
    if (!slug)
    {
        notifyError('Renseignez le titre de la recette avant de téléverser des photos.');
        return;
    }

    // Create blob URLs for immediate display
    const blobUrls = Array.from(files).map(file => URL.createObjectURL(file));
    const currentGallery = Array.isArray(getRecipe().gallery) ? getRecipe().gallery.filter(Boolean) : [];
    currentGallery.push(...blobUrls);
    blobUrls.forEach((blobUrl, index) =>
    {
        pendingGalleryFiles.set(blobUrl, files[index]);
    });
    renderGallery(currentGallery);
    saveLocally();
}

const coverInput = document.querySelector<HTMLInputElement>('#coverUpload');
if (coverInput)
    coverInput.addEventListener('change', async (ev: any) =>
    {
        const file: File = ev.target.files?.[0];
        if (!file)
            return;
        try
        {
            await handleCoverUpload(file);
        }
        catch (error)
        {
            notifyError(error.message || 'Erreur lors du téléversement de la couverture.');
        }
        ev.target.value = '';
    });

const galleryInput = document.querySelector<HTMLInputElement>('#galleryUpload');
if (galleryInput)
    galleryInput.addEventListener('change', async (ev: any) =>
    {
        const files: File[] = Array.from(ev.target.files || []);
        if (!files.length)
            return;
        try
        {
            await handleGalleryUpload(files);
        }
        catch (error)
        {
            notifyError(error.message || 'Erreur lors du téléversement des photos.');
        }
        ev.target.value = '';
    });

globalThis.triggerCoverUpload = function triggerCoverUpload()
{
    coverInput?.click();
}

globalThis.triggerGalleryUpload = function triggerGalleryUpload()
{
    galleryInput?.click();
}

globalThis.removeCover = function removeCover()
{
    if (pendingCoverFile?.blobUrl)
        URL.revokeObjectURL(pendingCoverFile.blobUrl);
    pendingCoverFile = null;
    renderCover('');
    saveLocally();
}

dynamic(document.querySelector('.info>.mold>.name'), {
    Enter(ev)
    {
        fetchmold(ev).then(() => ev.target.blur()).then(() => saveLocally());
    }
})

globalThis.loadRecipe = function (recipe)
{
    document.querySelector('h1').innerText = recipe.title;
    document.querySelector<HTMLInputElement>('input[name="private"]').checked = recipe.private;
    document.querySelector<HTMLElement>('.info .count').innerText = recipe.for;
    document.querySelector<HTMLElement>('.info .preptime').innerText = recipe.preptime;
    document.querySelector<HTMLElement>('.info .resttime').innerText = recipe.resttime;
    document.querySelector<HTMLElement>('.info .cooktime').innerText = recipe.cooktime;
    document.querySelector<HTMLElement>('.info .mold>.name').innerText = recipe.mold?.name;
    document.querySelector<HTMLImageElement>('.info .mold>a>img').src = recipe.mold?.picture;
    recipe.toppings?.forEach(t =>
    {
        const li = addtoppings(false);
        li.querySelector<HTMLElement>('.quantity').innerText = t.quantity;
        li.querySelector<HTMLElement>('.unit').innerText = t.unit;
        li.querySelector<HTMLElement>('.topping').innerText = t.name;
    })
    recipe.accessories?.forEach(a =>
    {
        const li = addAccessory(false);
        li.querySelector<HTMLElement>('.name').innerText = a.name;
        li.querySelector<HTMLImageElement>('img').src = a.picture;
        li.querySelector<HTMLAnchorElement>('a').href = a.url;
    })

    if (typeof recipe.steps === 'string')
    { mde.value(recipe.steps); }
    else
    {
        recipe.steps?.forEach(t =>
        {
            const li = addPrepStep(false);
            li.innerText = t;
        })
    }

    pendingCoverFile = null;
    pendingGalleryFiles.clear();
    galleryImages = Array.isArray(recipe.gallery) ? recipe.gallery.filter(Boolean) : [];
    renderCover(recipe.cover || '');
    renderGallery(galleryImages);

    document.querySelectorAll<HTMLElement>('.toolbar i').forEach(el => el.style.visibility = 'visible')
}

const mde = new globalThis.SimpleMDE({ spellChecer: false, element: document.querySelector('#steps>textarea') })
mde.codemirror.on('changes', () => saveLocally());

document.querySelector('.mold').addEventListener('click', () => document.querySelector<HTMLElement>('.info>.mold>.name').focus());
async function fetchmold(ev)
{
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
export function getRecipe()
{
    return {
        title: document.querySelector('h1').innerText,
        slug: getRecipeSlug(),
        private: document.querySelector<HTMLInputElement>('input[name="private"]').checked,
        toppings: Array.from(document.querySelectorAll('.toppings li')).map(li => ({
            quantity: li.querySelector<HTMLElement>('.quantity').innerText,
            unit: li.querySelector<HTMLElement>('.unit').innerText,
            name: li.querySelector<HTMLElement>('.topping').innerText
        })),
        accessories: Array.from(document.querySelectorAll('.accessories > ul > li')).map(span => ({
            name: span.querySelector<HTMLElement>('.name').innerText,
            picture: span.querySelector<HTMLImageElement>('img').src,
            url: span.querySelector<HTMLAnchorElement>('a').href,
        })),
        steps: mde.value() || Array.from(document.querySelectorAll<HTMLElement>('.steps li')).map(li => li.innerText),
        for: document.querySelector<HTMLElement>('.info .count').innerText,
        preptime: document.querySelector<HTMLElement>('.info .preptime').innerText,
        resttime: document.querySelector<HTMLElement>('.info .resttime').innerText,
        cooktime: document.querySelector<HTMLElement>('.info .cooktime').innerText,
        cover: document.querySelector<HTMLImageElement>('.cover-image').dataset.hasImage == 'true' ? document.querySelector<HTMLImageElement>('.cover-image').src : undefined,
        gallery: galleryImages,
        mold: {
            name: document.querySelector<HTMLElement>('.info>.mold').innerText,
            picture: document.querySelector<HTMLImageElement>('.info>.mold>a>img').src,
            url: document.querySelector<HTMLAnchorElement>('.info>.mold>a').href,
        },
    };
}

function saveLocally() { globalThis.saveLocally(getRecipe()); }

async function uploadPendingImages(recipe)
{
    const slug = recipe.slug || getRecipeSlug();
    if (!slug)
        throw new Error('Renseignez le titre de la recette avant de sauvegarder.');

    let updatedCover = recipe.cover;
    if (isBlobUrl(updatedCover))
    {
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
    for (const url of sourceGallery)
    {
        if (!url)
            continue;
        if (isBlobUrl(url))
        {
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
        else
        {
            updatedGallery.push(url);
        }
    }

    galleryImages = updatedGallery;
    renderGallery(galleryImages);

    return { ...recipe, cover: updatedCover, gallery: updatedGallery };
}

globalThis.saveAsDraft = async function saveAsDraft()
{
    const recipe = getRecipe();
    globalThis.saveLocally(recipe);

    const filename = `${dir}/recettes/${recipe.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ +/g, '-').toLowerCase()}.json`;
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'GET'
    });
    // console.log((await res.json()).sha);
    res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'DELETE', body: JSON.stringify(
            { "message": "delete " + recipe.title, "committer": { "name": localStorage.getItem('user.name'), "email": localStorage.getItem('user.email') }, sha: (await res.json()).sha }
        )
    });

    location.replace('/admin/recette/');
}
globalThis.save = async function save()
{
    document.querySelector<HTMLElement>('.toolbar').style.display = 'none';
    let recipe = getRecipe();
    try
    {
        recipe = await uploadPendingImages(recipe);
    }
    catch (error)
    {
        notifyError(error.message || 'Erreur lors du téléversement des images.');
        delete document.querySelector<HTMLElement>('.toolbar').style.display;
        return;
    }

    const filename = `${dir}/recettes/${recipe.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ +/g, '-').toLowerCase()}.json`;
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'GET'
    });

    const create = res.status == 404;
    if (create)
    {
        res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
            headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'PUT', body: JSON.stringify(
                { "message": "create " + recipe.title, "committer": { "name": localStorage.getItem('user.name'), "email": localStorage.getItem('user.email') }, "content": btoa(unescape(encodeURIComponent(JSON.stringify(recipe, null, 4)))) }
            )
        });
    }
    else
    {
        if (!res.ok)
        {
            Swal.fire({ title: 'Probleme lors de la recuperation', text: await res.text() });
            return;
        }

        res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
            headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'PUT', body: JSON.stringify(
                { "message": "update " + recipe.title, "committer": { "name": localStorage.getItem('user.name'), "email": localStorage.getItem('user.email') }, sha: (await res.json()).sha, "content": btoa(unescape(encodeURIComponent(JSON.stringify(recipe, null, 4)))) }
            )
        });
    }

    if (res.ok)
    {
        if (create)
        {
            globalThis.saveLocally({ ...recipe, toppings: [], steps: [], title: '' });
            let timerInterval;
            Swal.fire({
                title: "Recette enregistrée !",
                html: "Redirection vers la recette créée dans <b></b>s...",
                timerProgressBar: true,
                icon: "success",
                timer: 30000,
                didOpen: () =>
                {
                    Swal.showLoading();
                    const timer = Swal.getPopup().querySelector("b");
                    timerInterval = setInterval(() =>
                    {
                        timer.textContent = `${Swal.getTimerLeft() / 1000}`;
                    }, 1000);
                },
                willClose: () =>
                {
                    clearInterval(timerInterval);
                    location.replace(filename.substring(dir.length).replace('.json', '/'));
                }
            });
        }
        else
        {
            globalThis.saveLocally(null);
            Swal.fire({
                title: "Recette enregistrée !",
                timer: 10000,
                timerProgressBar: true,
                icon: "success",
                willClose: () =>
                {
                    delete document.querySelector<HTMLElement>('.toolbar').style.display;
                }
            });
        }

        if ('Notification' in globalThis)
        {
            const notif = await Notification.requestPermission();
            if (notif == "granted")
                new Notification('Recette enregistree');
        }

    }
    else
    {
        Swal.fire({
            title: "Une erreur s\'est produite",
            timer: 10000,
            timerProgressBar: true,
            icon: "error",
            text: await res.text()
        });
    }
}

function addAccessory(focus)
{
    const li = document.createElement('li')
    li.classList.add('mold');
    const a = document.createElement('a');
    a.target = '_blank';
    li.appendChild(a);
    const img = document.createElement('img');
    a.appendChild(img);
    const name = document.createElement('span')
    name.classList.add('name');
    name.contentEditable = true as unknown as string;
    li.appendChild(name);
    document.querySelector('.accessories>ul').appendChild(li);
    dynamic(name, {
        Enter: (ev: { target: HTMLElement }) =>
        {
            if (ev.target.innerText !== '' && ev.target.innerText !== '\n')
                fetchmold(ev).then(() => ev.target.blur()).then(() => saveLocally());
            else
            {
                li.remove();
                saveLocally();
            }
        }
    });
    if (focus)
        name.focus();
    return li;
}

globalThis.addAccessory = addAccessory

function addPrepStep(focus)
{
    const li = document.createElement('li')
    li.contentEditable = true as unknown as string;
    document.querySelector('.steps ol').appendChild(li);
    dynamic(li);
    if (focus)
        li.focus();
    li.addEventListener('blur', saveLocally);
    return li;
}

globalThis.addPrepStep = addPrepStep

function addtoppings(focus)
{
    const li = document.createElement('li')
    const quantity = document.createElement('span')
    const unit = document.createElement('span')
    const topping = document.createElement('span')
    quantity.classList.add('quantity');
    unit.classList.add('unit');
    topping.classList.add('topping');
    quantity.contentEditable = true as unknown as string;
    unit.contentEditable = true as unknown as string;
    topping.contentEditable = true as unknown as string;
    li.appendChild(quantity);
    li.appendChild(unit);
    li.appendChild(topping);
    // li.contentEditable = true;
    document.querySelector('.toppings ul').appendChild(li);
    dynamic(quantity, { Enter(ev) { unit.focus(); ev.preventDefault(); return false } })
    dynamic(unit, { Enter(ev) { topping.focus(); ev.preventDefault(); return false } })
    dynamic(topping, { Enter(ev) { topping.blur(); setTimeout(() => addtoppings(true)); ev.preventDefault(); return false } });
    if (focus)
        quantity.focus();
    quantity.addEventListener('blur', saveLocally);
    unit.addEventListener('blur', saveLocally);
    topping.addEventListener('blur', saveLocally);
    return li;
}
globalThis.addtoppings = addtoppings

function dynamic(self: HTMLElement, keys?: Record<string, (ev: KeyboardEvent & { target: HTMLElement }) => void>)
{
    keys = Object.assign({}, keys);
    self.addEventListener('keydown', function (ev)
    {
        if (self.innerText === '' && (ev.key == 'Delete' || ev.key == 'Backspace' || ev.key == 'Escape'))
        {
            self.blur();
        }
        //else if (this.innerText === '' && ev.key.length > 1 && ev.key !== 'Unidentified')
        //    self.innerText = ev.key;
        else if (ev.key in keys)
            keys[ev.key](ev as any);
    });
    self.addEventListener('blur', function (ev)
    {
        let li = self;
        while (li && li.tagName !== 'LI')
            li = li.parentElement;

        if (li?.textContent == '')
        {
            li.remove();
            saveLocally();
        }
    });
}
