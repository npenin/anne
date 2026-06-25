// Re-export @milkdown/crepe main component
export * from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
export { replaceAll } from '@milkdown/utils';
export { commonmark } from '@milkdown/kit/preset/commonmark'
export { gfm } from '@milkdown/kit/preset/gfm'

// // Re-export core editor
// export { Editor, EditorStatus } from '@milkdown/core';

// // Re-export preset components (GFM/CommonMark)
// export { gfm, strikethroughSchema, toggleStrikethroughCommand, createTable } from '@milkdown/preset-gfm';
// export { commonmark } from '@milkdown/preset-commonmark';

// // Re-export commonly used plugins and components
// export { block, blockConfig, BlockProvider } from '@milkdown/plugin-block';
// export { codeBlockComponent, codeBlockConfig } from '@milkdown/kit/component/code-block';
// export { imageBlockComponent, imageBlockConfig } from '@milkdown/kit/component/image-block';
// export { imageInlineComponent, inlineImageConfig } from '@milkdown/kit/component/image-inline';
// export { listItemBlockComponent, listItemBlockConfig } from '@milkdown/kit/component/list-item-block';
// export { tableBlockConfig, tableBlock } from '@milkdown/kit/component/table-block';
// export { linkTooltipConfig, linkTooltipPlugin, toggleLinkCommand } from '@milkdown/kit/component/link-tooltip';
// export { upload, uploadConfig } from '@milkdown/plugin-upload';
// export { history } from '@milkdown/plugin-history';
// export { indent, indentConfig } from '@milkdown/plugin-indent';
// export { listener, listenerCtx } from '@milkdown/plugin-listener';
// export { clipboard } from '@milkdown/plugin-clipboard';
// export { cursor } from '@milkdown/plugin-cursor';
