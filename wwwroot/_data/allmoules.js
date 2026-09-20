import { distinctStrings } from '@akala/core'
import recettes from './recettes.js'

export default async function allmoules()
{
    return distinctStrings((await recettes()).map(r => r.mold), m => m.name).map(m =>
    {
        const ebookId = /\/(\d+)-/.exec(m.url);

        if (!ebookId)
            console.log('no id found in ' + m.url);

        return {
            ...m,
            ebook: ebookId?.[1],
            displayName: m.name.replace(/([A-Z])([A-Z]+)/g, (_, letter, letters) => letter + letters.toLowerCase()),
        }
    })
};