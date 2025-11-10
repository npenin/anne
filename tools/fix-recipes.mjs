import { readdir, readFile, writeFile } from 'fs/promises';

const index = {};

const preferredUrls = [
    'https://boutique.guydemarle.com/epicerie-en-ligne/3510-mix-d-epices-special-pizza-pasta.html',
    'https://boutique.guydemarle.com/pates-a-pain-et-levures/119-preparation-pates-a-pizzas-facile-rapide.html',
    'https://boutique.guydemarle.com/toiles-et-tapis-de-cuisson/4508-toile-de-cuisson-en-silicone-40-x-30-cm.html',
    'https://boutique.guydemarle.com/ustensiles-de-cuisine-patisserie/649-lot-de-5-douilles-interchangeables-guy-demarle.html',
    'https://boutique.guydemarle.com/ustensiles-de-cuisine-patisserie/672-support-poches-a-douilles-guy-demarle.html',
    'https://boutique.guydemarle.com/ustensiles-de-cuisine-patisserie/2528-mini-louche-cuisine.html',
]

for (const recipeFile of await readdir('./recettes', { withFileTypes: true }))
{
    if (recipeFile.isFile() && recipeFile.name.endsWith('.json'))
    {
        const recipe = JSON.parse(await readFile('./recettes/' + recipeFile.name, 'utf-8'));
        if (!index[recipe.mold.name] && recipe.mold.url && !recipe.mold.url.startsWith('https://anneetsesdelices.fr/') && !recipe.mold.url.startsWith('http://localhost'))
            index[recipe.mold.name] = recipe.mold;
        else if (index[recipe.mold.name] && index[recipe.mold.name].url !== recipe.mold.url)
        {
            if (preferredUrls.includes(recipe.mold.url))
                index[recipe.mold.name] = recipe.mold;
            else if (!recipe.mold.url || recipe.mold.url.startsWith('https://anneetsesdelices.fr/') || recipe.mold.url.startsWith('http://localhost'))
                continue;
            else
                console.warn(`Conflict for mold ${recipe.mold.name}: "${index[recipe.mold.name].url}" vs "${recipe.mold.url}"`);
        }

        if (recipe.accessories?.length)
        {
            for (const accessory of recipe.accessories)
            {
                if (!index[accessory.name] && accessory.url && !accessory.url.startsWith('https://anneetsesdelices.fr/') && !accessory.url.startsWith('http://localhost'))
                    index[accessory.name] = accessory;
                else if (index[accessory.name] && index[accessory.name].url !== accessory.url)
                {
                    if (preferredUrls.includes(accessory.url))
                        index[accessory.name] = accessory;
                    else if (!accessory.url || accessory.url.startsWith('https://anneetsesdelices.fr/') || accessory.url.startsWith('http://localhost'))
                        continue;
                    else
                        console.warn(`Conflict for accessory ${accessory.name}: "${index[accessory.name].url}" vs "${accessory.url}"`);
                }

            }
        }
    }
}

for (const recipeFile of await readdir('./recettes', { withFileTypes: true }))
{
    if (recipeFile.isFile() && recipeFile.name.endsWith('.json'))
    {
        const recipe = JSON.parse(await readFile('./recettes/' + recipeFile.name, 'utf-8'));
        if (!index[recipe.mold.name])
            console.warn(`Missing mold ${recipe.mold.name} in index`);
        else
            if (index[recipe.mold.name].url !== recipe.mold.url)
                recipe.mold = index[recipe.mold.name];

        if (recipe.accessories?.length)
        {
            for (const accessory of recipe.accessories)
            {
                if (!index[accessory.name])
                    console.warn(`Missing accessory ${accessory.name} in index`);
                else if (index[accessory.name].url !== accessory.url)
                    Object.assign(accessory, index[accessory.name]);
            }
        }
        writeFile('./recettes/' + recipeFile.name, JSON.stringify(recipe, null, 4));
    }
}