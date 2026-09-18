const repositoryUrl = 'https://api.github.com/repos/npenin/anne';
const apiHeaders = token => ({
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28'
});

function showAdminGate(message = '')
{
    document.body.classList.add('admin-auth-required');

    const gate = document.createElement('main');
    gate.className = 'admin-auth-gate panel';
    gate.innerHTML = `
        <h1>Administration</h1>
        <p>Renseignez vos identifiants GitHub pour administrer le dépôt.</p>
        <form>
            <label for="github-token">Jeton GitHub</label>
            <input id="github-token" name="token" type="password" autocomplete="current-password" required />
            <label for="github-user-name">Nom du committer</label>
            <input id="github-user-name" name="user.name" type="text" autocomplete="name" required />
            <label for="github-user-email">Email du committer</label>
            <input id="github-user-email" name="user.email" type="email" autocomplete="email" required />
            <button type="submit">Se connecter</button>
            <p class="admin-auth-error" role="alert"></p>
        </form>`;

    document.body.appendChild(gate);

    if (message)
        gate.querySelector('.admin-auth-error').textContent = message;

    const form = gate.querySelector('form');
    const input = gate.querySelector('input');
    input.value = localStorage.getItem('GITHUB_TOKEN') || '';
    gate.querySelector('[name="user.name"]').value = localStorage.getItem('user.name') || '';
    gate.querySelector('[name="user.email"]').value = localStorage.getItem('user.email') || '';
    input.focus();

    form.addEventListener('submit', async event =>
    {
        event.preventDefault();
        const token = input.value.trim();
        const userName = gate.querySelector('[name="user.name"]').value.trim();
        const userEmail = gate.querySelector('[name="user.email"]').value.trim();
        const error = gate.querySelector('.admin-auth-error');
        const button = gate.querySelector('button');

        if (!token || !userName || !userEmail)
            return;

        button.disabled = true;
        error.textContent = 'Vérification en cours…';

        if (await validateToken(token))
        {
            localStorage.setItem('GITHUB_TOKEN', token);
            localStorage.setItem('user.name', userName);
            localStorage.setItem('user.email', userEmail);
            location.reload();
        }
        else
        {
            localStorage.removeItem('GITHUB_TOKEN');
            error.textContent = 'Ce jeton est invalide ou ne permet pas de modifier le dépôt.';
            button.disabled = false;
            input.select();
        }
    });
}

async function validateToken(token)
{
    try
    {
        const userResponse = await fetch('https://api.github.com/user', {
            headers: apiHeaders(token)
        });
        if (!userResponse.ok)
            return false;

        const repositoryResponse = await fetch(repositoryUrl, {
            headers: apiHeaders(token)
        });
        if (!repositoryResponse.ok)
            return false;

        const repository = await repositoryResponse.json();
        return repository.permissions?.push === true;
    }
    catch
    {
        return false;
    }
}

const token = localStorage.getItem('GITHUB_TOKEN');
const hasIdentity = localStorage.getItem('user.name')?.trim() && localStorage.getItem('user.email')?.trim();
const authenticated = token && hasIdentity && await validateToken(token);

if (authenticated)
{
    document.body.classList.remove('admin-auth-required');
    document.body.classList.add('admin-authenticated');
    document.querySelector('#admin-menu')?.removeAttribute('hidden');
}
else
{
    localStorage.removeItem('GITHUB_TOKEN');
    showAdminGate();
}

globalThis.adminAuthReady = Promise.resolve(!!authenticated);
