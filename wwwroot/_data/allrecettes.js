import fs from 'fs/promises'
import path from 'path'
import { parse } from 'marked'

export default async function ()
{
    let files = await fs.readdir(path.resolve('./recettes'));
    files = files.filter(f => f.endsWith('.json'));
    const result = await Promise.all(files.map(f_1 => fs.readFile(path.join('./recettes', f_1), { encoding: 'utf-8' }).then(r => ({ ...JSON.parse(r), filepath: path.basename(f_1, '.json') }))));

    // console.log(result);
    return result.map(r =>
    {
        const result = {}
        if (Array.isArray(r.toppings))
        {
            if (Object.entries(r.toppings[0]).filter(e => !e[1]).length == 2)
            {
                result.categorizedToppings = {};
                let toppingCategory = '';
                for (const topping of r.toppings)
                {
                    if (topping.unit == topping.quantity)
                    {
                        if (toppingCategory && result.categorizedToppings[toppingCategory])
                            result.categorizedToppings[toppingCategory][result.categorizedToppings[toppingCategory].length - 1].name = result.categorizedToppings[toppingCategory][result.categorizedToppings[toppingCategory].length - 1].name.replace(/(  ?)+$/, '')
                        toppingCategory = topping.name;
                        continue;
                    }
                    else if (topping.name == topping.quantity)
                    {
                        if (toppingCategory && result.categorizedToppings[toppingCategory])
                            result.categorizedToppings[toppingCategory][result.categorizedToppings[toppingCategory].length - 1].name = result.categorizedToppings[toppingCategory][result.categorizedToppings[toppingCategory].length - 1].name.replace(/(  ?)+/, '')
                        toppingCategory = topping.unit;
                        continue;
                    }
                    else if (topping.name == topping.unit)
                    {
                        if (toppingCategory && result.categorizedToppings[toppingCategory])
                            result.categorizedToppings[toppingCategory][result.categorizedToppings[toppingCategory].length - 1].name = result.categorizedToppings[toppingCategory][result.categorizedToppings[toppingCategory].length - 1].name.replace(/(  ?)+$/, '')
                        toppingCategory = topping.quantity;
                        continue;
                    }

                    if (!result.categorizedToppings[toppingCategory])
                        result.categorizedToppings[toppingCategory] = [];

                    result.categorizedToppings[toppingCategory].push(topping);
                }
            }
            else
                result.categorizedToppings = { '': r.toppings };
        }
        else
            result.categorizedToppings = r.toppings;

        if (Array.isArray(r.steps))
            r.formattedSteps = r.steps.reduce((previous, current, i) =>
            {
                if (i == 0 && /\n([^\n]{5,256})\n*$/m.test(current))
                    return current.replace(/^([^\n]+)\n+([^\n]{5,256})\n*$/m, '### $2\n\n1. $1') + '\n'
                return previous + (i + 1) + '. ' + current.replace(/\n([^-\n][^\n]{5,256})\n*$/, (m, g) => '\n### ' + g).replace(/\n- /g, '\n    - ') + '\n'
            }, '');
        else
            r.formattedSteps = r.steps;

        result.formattedSteps = parse(r.formattedSteps);
        return { ...r, ...result };
    });
};