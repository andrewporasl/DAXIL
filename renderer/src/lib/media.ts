import type { MediaAsset } from '../../../shared/types'

export const assetName = (asset: MediaAsset | undefined, fallback = ''): string => asset ? (asset.name?.trim() || asset.metadata.fileName) : fallback

export const sanitizeName = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
