import { distinctStrings } from "@akala/core";
import { EleventyHtmlBasePlugin } from "@11ty/eleventy";
export default function (config)
{
    config.addPassthroughCopy("wwwroot/assets");
    config.addPlugin(EleventyHtmlBasePlugin);
    config.addCollection("moules", function (collections)
    {
        const result = distinctStrings(collections.getFilteredByTag('recettes').filter(item => item.data.recette.mold?.name), (item) => item.data.recette.mold.name);
        // console.log(result.map(p => p.data.recette.mold));
        return result;
    });
    config.addCollection("importedItems", function (collections)
    {
        const items = new Map();

        for (const page of collections.getFilteredByTag('recettes'))
        {
            const recette = page.data.recette;
            const products = [
                recette.mold && { ...recette.mold, type: 'mold' },
                ...(recette.accessories || []).map(accessory => ({ ...accessory, type: 'accessory' }))
            ];

            for (const item of products)
            {
                if (item?.name && !items.has(`${item.type}:${item.name}`))
                    items.set(`${item.type}:${item.name}`, item);
            }
        }

        return [...items.values()].sort((left, right) => left.name.localeCompare(right.name, 'fr'));
    });
    config.addFilter("by-moule", function (recettes, moule)
    {
        return recettes.filter(r => r.data.recette.mold.name == moule);
    });
    return {
    };
};
