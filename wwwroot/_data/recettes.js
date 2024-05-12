const recettes = require('./allrecettes')

module.exports = async function ()
{
    return (await recettes()).filter(r => !r.private)
};