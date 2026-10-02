export * from './model'
export * from './codec'
export * from './generate'
export * from './generate-rows'
export * from './render-model'
export * from './imports'
export * from './editor-model'
export * from './api'
export * from './sales-api'
export * from './embed'
export * from './geometry-layout'
export * from './spatial-index'
export * from './object-pool'
export * from './theme'
export * from './units'
export * from './money'
export * from './duplicate'
export * from './validation'
export type { SceneController, SeatSelection } from './scene'
export type {
  EditorCallbacks,
  EditorController,
  EditorTool,
  EditorZone,
  FloorBackgroundTransform,
} from './editor'

/** Графический движок не попадает ни в начальный бандл приложения, ни в Worker. */
export async function createScene(
  ...args: Parameters<typeof import('./scene').createScene>
) {
  const renderer = await import('./scene')
  return renderer.createScene(...args)
}

export async function createEditorScene(
  ...args: Parameters<typeof import('./editor').createEditorScene>
) {
  const editor = await import('./editor')
  return editor.createEditorScene(...args)
}
