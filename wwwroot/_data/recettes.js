import recettes  from './allrecettes.js'

export default async function ()
{
    return (await recettes()).filter(r => {
        if(r.private)
            console.log('excluding '+r.title)
        return !r.private})
};