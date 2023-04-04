const fs = require('fs/promises')
const path = require('path')

module.exports = async function ()
{
    let files = await fs.readdir(path.resolve('./recettes'));
    files = files.filter(f => f.endsWith('.json'));
    const result = await Promise.all(files.map(f_1 => fs.readFile(path.join('./recettes', f_1), { encoding: 'utf-8' }).then(r => JSON.parse(r))));
    // console.log(result);
    return result;
};