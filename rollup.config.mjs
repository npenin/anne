import path from 'path';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import commonjs from '@rollup/plugin-commonjs';
import postcss from 'rollup-plugin-postcss';
import postcssImport from 'postcss-import';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default {
    input: 'src/crepe.mjs',
    output: {
        file: 'wwwroot/assets/milkdown.mjs',
        format: 'es',
        inlineDynamicImports: true,
        assetFileNames: 'assets/[name]-[hash][extname]',
    },
    plugins: [
        resolve({
            browser: true,
            preferBuiltins: true,
        }),
        replace({
            preventAssignment: true,           // required — avoids replacing on left-hand side of assignments
            'process.env.NODE_ENV': JSON.stringify('production'),
            'process.env': JSON.stringify({}), // catch-all for any other process.env.* accesses
        }),
        postcss({
            extract: 'milkdown.css',
            minimize: true,
            sourceMap: false,
            extensions: ['.css'],
            plugins: [
                postcssImport({
                    root: process.cwd(),
                    path: [path.resolve('node_modules')],
                    resolve(id, basedir)
                    {
                        if (id.startsWith('.') || id.startsWith('/'))
                        {
                            return path.resolve(basedir, id);
                        }

                        return require.resolve(id, { paths: [basedir, process.cwd()] });
                    },
                }),
            ],
        }),
        commonjs(),
    ],
};
