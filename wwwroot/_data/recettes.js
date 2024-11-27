const recettes = require('./allrecettes')

module.exports = async function ()
{
    return (await recettes()).filter(r => {
        if(r.private)
            console.log('excluding '+r.title)
        return !r.private})
};