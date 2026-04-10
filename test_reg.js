const str = 'C:\\Users\\Agencia IA\\N8N Agent\\enrich-clone\\output\\magnets\\davinci_magnet_1775834410197.png';
const regex = /(?:file:\/\/\/?)?[A-Za-z]:\\[\w\\\-\s.]+\.\w+/gi;
console.log(str.replace(regex, 'REPLACED'));
