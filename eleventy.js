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
    config.addFilter("by-moule", function (recettes, moule)
    {
        return recettes.filter(r => r.data.recette.mold.name == moule);
    });
    return {
    };
};
