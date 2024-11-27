const { distinctStrings } = require('@akala/core')
const recettes = require('./recettes')

module.exports = async function ()
{
    return distinctStrings((await recettes()).map(r => r.mold), m => m.name);
};