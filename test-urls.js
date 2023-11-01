const fs = require('fs/promises')

const failures = [];
fs.readdir(__dirname + '/recettes').then(async files =>
{
    await files.reduce(async (previous, current) =>
    {

        await previous;
        const file = await fs.readFile(__dirname + '/recettes/' + current);
        const recipe = JSON.parse(file);
        console.log("testing " + recipe.title);
        if ('mold' in recipe.mold)
            if (!(await fetch(recipe.mold.picture)).ok)
            {
                failures.push({ recipe, accessory: recipe.mold });
                return;
            }

        await recipe.accessories.reduce(async (previous, current) =>
        {
            await previous;
            if (!(await fetch(current.picture)).ok)
            {
                if (failures.indexOf(recipe) == -1)
                    failures.push({ recipe, accessory: current });
            }
        }, Promise.resolve());

    }, Promise.resolve());

    if (failures.length)
    {
        console.log('Failed recipes:')
        failures.forEach(r => console.log(r.recipe.title, r.accessory.name));
    }
});