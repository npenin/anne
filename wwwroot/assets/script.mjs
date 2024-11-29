
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
const root = window.location.href.substring(0, window.location.href.length - '{{page.url}}'.length + '/admin/'.length);

await Notification.requestPermission();

dynamic(document.querySelector('.info>.mold>.name'), {
    Enter(ev)
    {
        fetchmold(ev).then(() => ev.target.blur()).then(() => saveLocally());
    }
})

window.loadRecipe = function (recipe)
{
    document.querySelector('h1').innerText = recipe.title;
    document.querySelector('.info .count').innerText = recipe.for;
    document.querySelector('.info .preptime').innerText = recipe.preptime;
    document.querySelector('.info .resttime').innerText = recipe.resttime;
    document.querySelector('.info .cooktime').innerText = recipe.cooktime;
    document.querySelector('.info .mold>.name').innerText = recipe.mold?.name;
    document.querySelector('.info .mold>a>img').src = recipe.mold?.picture;
    recipe.toppings?.forEach(t =>
    {
        const li = addtoppings(false);
        li.querySelector('.quantity').innerText = t.quantity;
        li.querySelector('.unit').innerText = t.unit;
        li.querySelector('.topping').innerText = t.name;
    })
    recipe.accessories?.forEach(a =>
    {
        const li = addAccessory(false);
        li.querySelector('.name').innerText = a.name;
        li.querySelector('img').src = a.picture;
        li.querySelector('a').href = a.url;
    })

    if (typeof recipe.steps !== 'string')
        recipe.steps?.forEach(t =>
        {
            const li = addPrepStep(false);
            li.innerText = t;
        })

    document.querySelector('.fa-save').style.visibility = 'visible'
}


document.querySelector('.mold').addEventListener('click', () => document.querySelector('.info>.mold>.name').focus());
async function fetchmold(ev)
{
    const res = await fetch(new URL(ev.target.innerText.replace('https://boutique.guydemarle.com', 'https://d2quloop9d8ihx.cloudfront.net'), root));
    const content = res.text();
    const dummy = document.createElement('div');
    dummy.innerHTML = await content;
    const meta = Object.fromEntries(Array.from(dummy.querySelectorAll('meta').values()).filter(v => v.attributes.property).map(v => [v.attributes.property.value, v.attributes.content.value]));
    dummy.remove();
    ev.target.innerText = meta['og:title'];
    ev.target.parentNode.querySelector('img').src = meta['og:image'];
    ev.target.parentNode.querySelector('a').href = meta['og:url'];
}

window.fetchmold = fetchmold;
function getRecipe()
{
    return {
        title: document.querySelector('h1').innerText,
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
        steps: Array.from(document.querySelectorAll('.steps li')).map(li => li.innerText),
        for: document.querySelector('.info .count').innerText,
        preptime: document.querySelector('.info .preptime').innerText,
        resttime: document.querySelector('.info .resttime').innerText,
        cooktime: document.querySelector('.info .cooktime').innerText,
        mold: {
            name: document.querySelector('.info>.mold').innerText,
            picture: document.querySelector('.info>.mold>a>img').src,
            url: document.querySelector('.info>.mold>a').href,
        },
    };
}

function saveLocally() { }

window.save = async function save()
{
    document.querySelector('.toolbar').style.display = 'none';
    const recipe = getRecipe();

    const filename = `${dir}/recettes/${recipe.title.replace(/[^a-z]+/gi, '-').toLowerCase()}.json`;
    let res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'GET'
    });

    if (res.status !== 404)
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
    else
    {
        res = await fetch('https://api.github.com/repos/npenin/anne/contents/' + filename.substring(dir.length + 1), {
            headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }, method: 'PUT', body: JSON.stringify(
                { "message": "update " + recipe.title, "committer": { "name": localStorage.getItem('user.name'), "email": localStorage.getItem('user.email') }, "content": btoa(unescape(encodeURIComponent(JSON.stringify(recipe, null, 4)))) }
            )
        });
    }

    if (res.ok)
    {
        Swal.fire({
            title: "Recette enregistrée !",
            timer: 10000,
            timerProgressBar: true,
            icon: "success",
            willClose: () =>
            {
                delete document.querySelector('.toolbar').style.display;
            }
        });

        if ('Notification' in window)
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
    name.contentEditable = true;
    li.appendChild(name);
    document.querySelector('.accessories>ul').appendChild(li);
    dynamic(name, {
        Enter: (ev) =>
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

window.addAccessory = addAccessory

function addPrepStep(focus)
{
    const li = document.createElement('li')
    li.contentEditable = true;
    document.querySelector('.steps ol').appendChild(li);
    dynamic(li);
    if (focus)
        li.focus();
    li.addEventListener('blur', saveLocally());
    return li;
}

window.addPrepStep = addPrepStep

function addtoppings(focus)
{
    const li = document.createElement('li')
    const quantity = document.createElement('span')
    const unit = document.createElement('span')
    const topping = document.createElement('span')
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
    dynamic(quantity, { Enter(ev) { unit.focus(); ev.preventDefault(); return false } })
    dynamic(unit, { Enter(ev) { topping.focus(); ev.preventDefault(); return false } })
    dynamic(topping, { Enter(ev) { topping.blur(); setTimeout(() => addtoppings(true)); ev.preventDefault(); return false } });
    if (focus)
        quantity.focus();
    quantity.addEventListener('blur', saveLocally());
    unit.addEventListener('blur', saveLocally());
    topping.addEventListener('blur', saveLocally());
    return li;
}
window.addtoppings = addtoppings

function dynamic(self, keys)
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
            keys[ev.key](ev);
    });
    self.addEventListener('blur', function (ev)
    {
        let li = self;
        while (li && li.tagName !== 'LI')
            li = li.parentNode;

        if (li && li.textContent == '')
        {
            li.remove();
            saveLocally();
        }
    });
}
