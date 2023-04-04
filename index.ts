import Server from 'express'
import { Writable } from 'node:stream'
import * as fs from 'node:fs'
import path from 'node:path'
import { json as jsonbodyparser } from 'body-parser'

const server = Server()

server.get(/\/boutique\/.+$/, (req, res) =>
{
    const url = new URL(req.path.substring('/boutique/'.length), 'https://boutique.guydemarle.com/');
    console.log(url);
    fetch(url).then(r => r.body?.pipeTo(Writable.toWeb(res)));
});
const recettes = Server();

server.use('/admin/', recettes);

server.use(Server.static(path.resolve('./_site'), { fallthrough: true }));

recettes.post('/recette', jsonbodyparser(), async (req, res) =>
{
    const recipe = req.body
    try
    {
        fs.promises.writeFile('recettes/' + recipe.title.replace(/[^a-z]+/gi, '-').toLowerCase() + '.json', JSON.stringify(recipe));
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