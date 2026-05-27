import { distinctStrings } from '@akala/core'
import recettes from './recettes.js'

export const hiddenMoules = new Set([
    // Add mold names here to exclude them from the public molds list,
    // while keeping their dedicated mold page available.
    // Example:
    // 'Moule 3 baguettes OHRA®'
])

export default async function ()
{
    const molds = (await recettes()).map(r => r.mold).filter(m => m && m.name);
    return distinctStrings(molds, m => m.name).map(m => ({
        ...m,
        displayName: m.name.replace(/([A-Z])([A-Z]+)/g, (_, letter, letters) => letter + letters.toLowerCase()),
    }))
};
