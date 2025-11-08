import { distinctStrings } from '@akala/core'
import recettes from './recettes.js'

export default async function ()
{
    return distinctStrings((await recettes()).map(r => r.mold), m => m.name).map(m => ({
        ...m,
        displayName: m.name.replace(/([A-Z])([A-Z]+)/g, (_, letter, letters) => letter + letters.toLowerCase()),
    }))
};