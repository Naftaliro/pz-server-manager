import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { MODDED_PRESETS, MODDED_PRESET_SOURCES, presetProfileMods, buildPreset, downloadMinutes } from './modPresets'
import { isWorkshopId, isListSorted, orderModIds, wrongBuildMods, enabledIds, buildMapLine, parseModInfo } from '../../shared/modCore'
import { steamImageUrl } from '../../shared/workshopItem'
import { cleanHostSettings } from '../../shared/serverPack'
import { missingRequirements, needsChoice, disabledRequirements } from './mods'
import type { ServerProfile } from '../store/useAppStore'

const asProfile = (mods: ServerProfile['mods']) => ({ mods, buildVersion: 'b42' } as ServerProfile)

// sandbox names that only B41 knows (B42 renamed or dropped them), the game ignores them
const B41_ONLY = ['FoodLoot', 'WeaponLoot', 'OtherLoot', 'CannedFoodLoot', 'LiteratureLoot', 'SurvivalGearsLoot', 'MedicalLoot', 'RangedWeaponLoot', 'AmmoLoot', 'MechanicsLoot', 'LootRespawn']

describe('ready-made modded servers', () => {
  it('has a Vanilla+ preset and unique keys', () => {
    expect(MODDED_PRESETS.map(p => p.key)).toContain('vanilla-plus')
    expect(new Set(MODDED_PRESETS.map(p => p.key)).size).toBe(MODDED_PRESETS.length)
    expect(new Set(MODDED_PRESETS.map(p => p.label)).size).toBe(MODDED_PRESETS.length)
  })

  for (const preset of MODDED_PRESETS) {
    const source = MODDED_PRESET_SOURCES.find(s => s.key === preset.key)!
    describe(preset.label, () => {
      it('presetData.json matches the list in modPresets.ts (run verify-presets.mjs refresh after changing it)', () => {
        const want = source.items.map(i => ('local' in i ? `local:${i.local}` : `${i.workshopId}:${[...i.mods].sort().join(';')}`)).sort()
        const have = preset.mods.map(m => (m.workshopId ? `${m.workshopId}:${enabledIds(m).sort().join(';')}` : `local:${m.modId}`)).sort()
        expect(have).toEqual(want)
      })

      it('only real Workshop ids, none twice', () => {
        const ids = preset.mods.filter(m => m.workshopId).map(m => m.workshopId)
        expect(ids.every(isWorkshopId)).toBe(true)
        expect(new Set(ids).size).toBe(ids.length)
        const modIds = preset.mods.flatMap(enabledIds)
        expect(new Set(modIds).size).toBe(modIds.length)
        // local fix mods are the only entries without a Workshop id
        expect(preset.mods.filter(m => !m.workshopId).map(m => m.modId).sort()).toEqual([...preset.localMods].sort())
      })

      it('every Workshop mod has a picture from Steam and a size, so downloads show progress', () => {
        for (const m of preset.mods.filter(m => m.workshopId)) {
          expect(steamImageUrl(m.thumbnailUrl), m.name).toBeTruthy()
          expect(m.fileSize, m.name).toBeGreaterThan(0)
        }
        expect(preset.downloadBytes).toBe(preset.mods.reduce((n, m) => n + (m.workshopId ? m.fileSize || 0 : 0), 0))
      })

      it('the load order is already the one the app sorts to, with the real mod.info rules', () => {
        expect(preset.mods.every(m => m.infos && m.infos.length > 0)).toBe(true)
        expect(isListSorted(preset.mods)).toBe(true)
        // and before the downloads finish, when the list only has what the preset says
        expect(isListSorted(presetProfileMods(preset))).toBe(true)
        expect(orderModIds(preset.mods).problems).toEqual([])
      })

      it('nothing the Mods tab would warn about: requirements, build, choices', () => {
        expect(missingRequirements(asProfile(preset.mods))).toEqual([])
        expect(disabledRequirements(asProfile(preset.mods))).toEqual([])
        expect(preset.mods.filter(needsChoice)).toEqual([])
        expect(wrongBuildMods(preset.mods, 'b42')).toEqual([])
        for (const m of preset.mods) for (const id of enabledIds(m)) expect(m.infos?.some(i => i.id === id), `${m.name}: ${id}`).toBe(true)
      })

      it('map mods are in the map line, before the base game map', () => {
        const maps = preset.mods.flatMap(m => (m.infos || []).filter(i => enabledIds(m).includes(i.id)).flatMap(i => i.maps))
        const line = buildMapLine(preset.mods, undefined).split(';')
        for (const map of maps) expect(line.indexOf(map)).toBeGreaterThanOrEqual(0)
        expect(line[line.length - 1]).toBe('Muldraugh, KY')
      })

      it('was test-started on a real server (scripts/verify-presets.mjs verify --update)', () => {
        expect(preset.verified).toBeDefined()
        expect(preset.verified!.gameVersion).toMatch(/^42\.\d+/)
        expect(preset.verified!.buildId).toMatch(/^\d+$/)
        expect(preset.verified!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(preset.verified!.ok).toBe(true)
      })

      it('its fix mods are in local-mods/ with the same id', () => {
        for (const id of preset.localMods) {
          const folder = ['FirearmsLegacyId', 'RVInteriorGMCVans'].find(f => {
            const p = join(__dirname, '..', '..', 'local-mods', f, '42', 'mod.info')
            return existsSync(p) && parseModInfo(readFileSync(p, 'utf-8')).id === id
          })
          expect(folder, id).toBeTruthy()
        }
      })

      it('settings are plain values a server pack can carry, and B42 names', () => {
        const { dropped } = cleanHostSettings({ ini: preset.iniSettings as Record<string, string | number | boolean>, sandbox: preset.sandboxSettings })
        expect(dropped).toEqual([])
        for (const key of B41_ONLY) expect(preset.sandboxSettings).not.toHaveProperty(key)
        // the wizard asks these itself
        for (const key of ['PVP', 'Password', 'MaxPlayers', 'PublicName', 'Mods', 'WorkshopItems', 'Map']) expect(preset.iniSettings).not.toHaveProperty(key)
      })

      it('stays a reasonable download', () => {
        expect(preset.downloadBytes).toBeLessThan(1024 ** 3)
        if (preset.key === 'vanilla-plus') expect(preset.downloadBytes).toBeLessThan(50 * 1024 ** 2)
      })
    })
  }

  it('a server made from a preset gets no mod.info copies (it reads its own after downloading)', () => {
    const mods = presetProfileMods(MODDED_PRESETS[0])
    expect(mods.every(m => !('infos' in m))).toBe(true)
    expect(mods.map(m => m.workshopId)).toEqual(MODDED_PRESETS[0].mods.map(m => m.workshopId))
  })

  it('a list that presetData.json doesn\'t know yet still makes a usable server', () => {
    const p = buildPreset(MODDED_PRESET_SOURCES[1], undefined)
    expect(p.mods.length).toBe(MODDED_PRESET_SOURCES[1].items.length)
    expect(p.mods.every(m => m.modId)).toBe(true)
    expect(p.verified).toBeUndefined()
  })

  it('download time: at least a minute, more for bigger presets', () => {
    expect(downloadMinutes({ downloadBytes: 0, mods: [] })).toBe(1)
    expect(downloadMinutes({ downloadBytes: 700 * 1024 ** 2, mods: Array(14).fill({ workshopId: '1' }) as never })).toBe(3)
  })
})
