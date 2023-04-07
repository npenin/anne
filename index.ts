import Server from 'express'
import { Writable } from 'node:stream'
import * as fs from 'node:fs'
import path from 'node:path'
import { json as jsonbodyparser } from 'body-parser'
import cookieParser = require('cookie-parser')
import { webcrypto as crypto } from 'node:crypto'
import credentials from './credentials.json'
import { spawn } from 'node:child_process'
const Eleventy = require('@11ty/eleventy');

const server = Server()

server.get(/\/boutique\/.+$/, (req, res) =>
{
    const url = new URL(req.path.substring('/boutique/'.length), 'https://boutique.guydemarle.com/');
    console.log(url);
    fetch(url).then(r => r.body?.pipeTo(Writable.toWeb(res)));
});
const recettes = Server();

const adminCookies = {};

const key = fs.promises.readFile('key.pem').then(f =>
{
    return crypto.subtle.importKey('raw', f, { name: 'HMAC', hash: { name: 'SHA-512' } }, false, ['sign', 'verify']);
}, async () =>
{
    const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: { name: 'SHA-512' } }, true, ['sign', 'verify'])
    await fs.promises.writeFile('key.pem', Buffer.from((await crypto.subtle.exportKey('raw', key))));
    return key
})

server.use('/admin/', cookieParser(), async (req, res, next) =>
{
    console.log(req.headers)
    if (req.cookies.auth in adminCookies)
    {
        req.user = req.cookies.auth;
        next();
        return;
    }
    if (req.headers.authorization)
    {
        const signedAuth = Buffer.from(await crypto.subtle.sign('HMAC', await key, Buffer.from(req.headers.authorization.substring('Basic '.length), 'base64'))).toString('base64');
        console.log(signedAuth);
        if (signedAuth in credentials)
        {
            req.user = signedAuth;
            next();
            return;
        }
    }
    res.status(401).append('WWW-Authenticate', 'Basic').end();
}, (req, res, next) =>
{
    res.append('set-cookie', `auth=${req.user}; path=/; HttpOnly; Secure`);
    adminCookies[req.user] = credentials[req.user];
    next();
}, recettes);

server.use(Server.static(path.resolve('./_site'), { fallthrough: true }));

recettes.get('/git', () =>
{
    spawn('git', ['pull', '--rebase'], { shell: true })
})

recettes.post('/recette', jsonbodyparser(), async (req, res) =>
{
    const recipe = req.body
    try
    {
        await fs.promises.writeFile('recettes/' + recipe.title.replace(/[^a-z]+/gi, '-').toLowerCase() + '.json', JSON.stringify(recipe));

        const eleventy = new Eleventy("wwwroot", "_site", {
            configPath: 'eleventy.js'
        });
        await eleventy.wite();
        res.status(201);
        res.end();
    }
    catch (e)
    {
        res.status(500);
        if (e)
            res.write(e.toString())
        res.end();
    }
})

server.listen(3000);