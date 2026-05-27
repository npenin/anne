import allmoules from './allmoules.js'

const hiddenMoules = new Set([
    // Add mold names here to exclude them from the public molds list,
    // while keeping their dedicated mold page available.
    // Example:
    // 'Moule 3 baguettes OHRA®'
    'Borealia® - Turbine à glace & Yaourtière'
]);

export default function moules()
{
    return allmoules().then(m => m.filter(m => !hiddenMoules.has(m.name)));
};