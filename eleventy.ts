const { EleventyHtmlBasePlugin } = require("@11ty/eleventy");

const months = [
    { short: 'Jan.', long: 'Janvier' },
    { short: 'Fév.', long: 'Février' },
    { short: 'Mars', long: 'Mars' },
    { short: 'Avr.', long: 'Avril' },
    { short: 'Mai', long: 'Mai' },
    { short: 'Juin', long: 'Juin' },
    { short: 'Juil.', long: 'Juillet' },
    { short: 'Aout', long: 'Aout' },
    { short: 'Sep.', long: 'Septembre' },
    { short: 'Oct.', long: 'Octobre' },
    { short: 'Nov.', long: 'Novembre' },
    { short: 'Déc.', long: 'Décembre' }
]
const days = [
    { short: 'Lun', long: 'Lundi' },
    { short: 'Mar', long: 'Mardi' },
    { short: 'Mer', long: 'Mercredi' },
    { short: 'Jeu', long: 'Jeudi' },
    { short: 'Ven', long: 'Vendredi' },
    { short: 'Sam', long: 'Samedi' },
    { short: 'Dim', long: 'Dimanche' },
]

module.exports = function (config: any)
{
    config.addPassthroughCopy("wwwroot/assets");
    config.addPlugin(EleventyHtmlBasePlugin);
    config.addShortcode("dateFormat", function (date: Date, format: string)
    {
        return format.replace(/[YMDHms]+/g, (m) =>
        {
            console.log(m);
            switch (m[0])
            {
                case 'Y':
                    if (m.length < 4)
                    {
                        if (date.getFullYear() >= 2000)
                            return (date.getFullYear() - 2000).toString();
                        return (date.getFullYear() - 1900).toString();
                    }
                    return date.getFullYear().toString();
                case 'M':
                    switch (m.length)
                    {
                        case 1:
                            return (date.getMonth() + 1).toString();
                        case 2:
                            return (date.getMonth() + 1).toString().padStart(2, '0');
                        case 3:
                            return months[date.getMonth()].short;
                        case 4:
                            return months[date.getMonth()].long;
                    }
                    break;
                case 'D':
                    switch (m.length)
                    {
                        case 1:
                            return date.getDate().toString();
                        case 2:
                            return date.getDate().toString().padStart(2, '0');
                        case 3:
                            return days[date.getMonth()].short;
                        case 4:
                            return days[date.getMonth()].long;
                    }
                    break;
            }
            return m;
        });
    });
    return {
        pathPrefix: '/proxy/3000/'
    };
} 