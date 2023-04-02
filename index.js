"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_stream_1 = require("node:stream");
const fs = __importStar(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const body_parser_1 = require("body-parser");
const server = (0, express_1.default)();
server.get(/\/boutique\/.+$/, (req, res) => {
    const url = new URL(req.path.substring('/boutique/'.length), 'https://boutique.guydemarle.com/');
    console.log(url);
    fetch(url).then(r => { var _a; return (_a = r.body) === null || _a === void 0 ? void 0 : _a.pipeTo(node_stream_1.Writable.toWeb(res)); });
});
const recettes = (0, express_1.default)();
server.use('/recette/', recettes);
recettes.use(express_1.default.static(node_path_1.default.resolve('./wwwroot'), { fallthrough: true }));
recettes.get('*.json', express_1.default.static(node_path_1.default.resolve('recettes'), { fallthrough: false }));
recettes.get('*', (req, res) => {
    res.sendFile(node_path_1.default.resolve('./wwwroot/index.html'));
});
recettes.post('/', (0, body_parser_1.json)(), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const recipe = req.body;
    try {
        fs.promises.writeFile('recettes/' + recipe.title.replace(/[^a-z]+/gi, '-').toLowerCase() + '.json', JSON.stringify(recipe));
        res.status(201);
        res.end();
    }
    catch (e) {
        res.status(500);
        if (e)
            res.write(e.toString());
        res.end();
    }
}));
server.listen(3000);
