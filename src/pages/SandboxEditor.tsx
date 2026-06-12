import { useState, useEffect } from 'react'
import { Save, ArrowLeft, RotateCcw, Download, Upload, Search, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

type SandboxSettings = Record<string, unknown>

const DEFAULT_ZOMBIE_CONFIG: SandboxSettings = {
  PopulationMultiplier: 1.0, PopulationStartMultiplier: 1.0, PopulationPeakMultiplier: 1.5,
  PopulationPeakDay: 28, RespawnHours: 72.0, RespawnUnseenHours: 16.0, RespawnMultiplier: 0.1,
  RedistributeHours: 12.0, FollowSoundDistance: 100, RallyGroupSize: 20, RallyTravelDistance: 20,
  RallyGroupSeparation: 15, RallyGroupRadius: 3, Speed: 3, Strength: 2, Toughness: 2,
  Transmission: 2, Intelligence: 2, CrawlUnderVehicle: 1, Memory: 2, Decomp: 1,
  Sight: 2, Hearing: 2, Smell: 2, ThumpNoChasing: false, ThumpOnConstruction: true,
  ActiveOnly: false, TriggerHouseAlarm: false, ZombiesDontAttackUnlessThreatened: false, DisableFakeDead: false,
}

const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  VERSION: 4, Zombies: 4, Distribution: 1, DayLength: 3, StartYear: 1, StartMonth: 7,
  StartDay: 1, StartTime: 2, WaterShut: 2, ElecShut: 2, WaterShutModifier: 14, ElecShutModifier: 14,
  FoodLoot: 4, WeaponLoot: 2, OtherLoot: 3, CannedFoodLoot: 4, LiteratureLoot: 4,
  SurvivalGearsLoot: 4, MedicalLoot: 4, RangedWeaponLoot: 2, AmmoLoot: 2, MechanicsLoot: 4,
  Temperature: 3, Rain: 3, ErosionSpeed: 3, ErosionDays: 0, XpMultiplier: 1.0,
  XpMultiplierAffectsPassive: false, ZombieAttractionMultiplier: 1.0, VehicleEasyUse: false,
  Farming: 3, CompostTime: 2, StatsDecrease: 3, NatureAbundance: 3, Alarm: 6, LockedHouses: 6,
  StarterKit: false, Nutrition: true, FoodRotSpeed: 3, FridgeFactor: 3, LootRespawn: 1,
  SeenHoursPreventLootRespawn: 0, HoursForWorldItemRemoval: 24.0, ItemRemovalListBlacklistToggle: false,
  TimeSinceApo: 1, PlantResilience: 3, PlantAbundance: 3, EndRegen: 3, Helicopter: 2,
  MetaEvent: 2, SleepingEvent: 1, GeneratorSpawning: 3, GeneratorFuelConsumption: 1.0,
  SurvivorHouseChance: 3, VehicleStoryChance: 3, ZoneStoryChance: 3, AnnotatedMapChance: 4,
  CharacterFreePoints: 0, ConstructionBonusPoints: 3, NightDarkness: 3, NightLength: 3,
  InjurySeverity: 2, BoneFracture: true, HoursForCorpseRemoval: 216.0, DecayingCorpseHealthImpact: 3,
  BloodLevel: 3, ClothingDegradation: 3, FireSpread: true, DaysForRottenFoodRemoval: -1,
  AllowExteriorGenerator: true, MaxFogIntensity: 1, MaxRainFxIntensity: 1, EnableSnowOnGround: true,
  MultiHitZombies: false, RearVulnerability: 3, AttackBlockMovements: true, AllClothesUnlocked: false,
  EnableTaintedWaterText: true, CarSpawnRate: 3, ChanceHasGas: 4, InitialGas: 4,
  CarGasConsumption: 1.0, LockedCar: 4, CarHotwire: 4, CarConditionAffectsStat: 3,
  CarDamageOnImpact: 3, DamageToPlayerFromHitByACar: 3, EnableVehicles: true, EnableTrailerHitch: true,
  // B42 additions
  AnimalPopulationMultiplier: 1.0, AnimalPopulationStartMultiplier: 1.0, AnimalPopulationPeakMultiplier: 1.5,
  AnimalPopulationPeakDay: 28, AnimalChanceSpawnOnFarm: 1, AgingModifierSpeed: 1.0,
  MilkIncreaseSpeed: 1.0, WoolIncreaseSpeed: 1.0,
  CraftMultiplier: 1.0, MaxCraftableItemsOnGround: 0,
}

const PRESETS = {
  apocalypse: {
    label: 'Apocalypse',
    description: 'Lore-canon mode. Zombie respawn disabled, more firearms.',
    settings: {
      Zombies: 4, Distribution: 1, DayLength: 3, XpMultiplier: 1.0,
      FoodLoot: 4, WeaponLoot: 3, OtherLoot: 3,
      ZombieConfig: { Speed: 3, Strength: 2, Toughness: 2, RespawnHours: 0, PopulationMultiplier: 1.0 }
    }
  },
  outbreak: {
    label: 'Outbreak',
    description: 'Faster progression, more forgiving. Good for limited time.',
    settings: {
      Zombies: 3, Distribution: 1, DayLength: 3, XpMultiplier: 2.0,
      FoodLoot: 5, WeaponLoot: 4, OtherLoot: 4,
      ZombieConfig: { Speed: 3, Strength: 2, Toughness: 2, RespawnHours: 72, PopulationMultiplier: 0.75 }
    }
  },
  extinction: {
    label: 'Extinction',
    description: 'Veterans only. Sprinters, scarce supplies.',
    settings: {
      Zombies: 1, Distribution: 1, DayLength: 3, XpMultiplier: 1.0,
      FoodLoot: 2, WeaponLoot: 2, OtherLoot: 2,
      ZombieConfig: { Speed: 1, Strength: 1, Toughness: 1, RespawnHours: 72, PopulationMultiplier: 2.0 }
    }
  },
  rising: {
    label: 'Rising',
    description: 'Cozy apocalypse. More building materials, less combat pressure.',
    settings: {
      Zombies: 5, Distribution: 1, DayLength: 3, XpMultiplier: 1.5,
      FoodLoot: 5, WeaponLoot: 3, OtherLoot: 5,
      ZombieConfig: { Speed: 3, Strength: 3, Toughness: 3, RespawnHours: 72, PopulationMultiplier: 0.5 }
    }
  },
}

export default function SandboxEditor() {
  const { activeProfileId, setActiveView, profiles, setProfiles } = useAppStore()
  const [settings, setSettings] = useState<SandboxSettings>({})
  const [zombieConfig, setZombieConfig] = useState<SandboxSettings>({})
  const [tab, setTab] = useState<'zombies' | 'loot' | 'world' | 'player' | 'events' | 'vehicles' | 'b42' | 'advanced'>('zombies')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const searchLower = searchQuery.toLowerCase().trim()

  const profile = profiles.find(p => p.id === activeProfileId)
  const isB42 = profile?.buildVersion === 'b42'

  useEffect(() => {
    if (profile) {
      const s = profile.sandboxSettings || {}
      const zc = (s.ZombieConfig as SandboxSettings) || {}
      setSettings(s)
      setZombieConfig(zc)
    }
  }, [activeProfileId])

  const set = (key: string, value: unknown) => setSettings(prev => ({ ...prev, [key]: value }))
  const setZC = (key: string, value: unknown) => setZombieConfig(prev => ({ ...prev, [key]: value }))
  const get = (key: string, fallback: unknown) => settings[key] !== undefined ? settings[key] : fallback
  const getZC = (key: string, fallback: unknown) => zombieConfig[key] !== undefined ? zombieConfig[key] : fallback

  const resetToDefaults = () => {
    if (!window.confirm('Reset all sandbox settings to default values? This cannot be undone.')) return
    setSettings(DEFAULT_SANDBOX_SETTINGS)
    setZombieConfig(DEFAULT_ZOMBIE_CONFIG)
  }

  const applyPreset = (presetKey: keyof typeof PRESETS) => {
    const preset = PRESETS[presetKey]
    const { ZombieConfig, ...rest } = preset.settings as { ZombieConfig?: SandboxSettings } & SandboxSettings
    setSettings(prev => ({ ...prev, ...rest }))
    if (ZombieConfig) setZombieConfig(prev => ({ ...prev, ...ZombieConfig }))
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const fullSettings = { ...settings, ZombieConfig: zombieConfig }
      const serverName = profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')
      const dataPath = profile.worldSavePath || `%USERPROFILE%\\Zomboid`
      await window.electronAPI.config.writeSandbox(serverName, dataPath, fullSettings)
      const updatedProfile = { ...profile, sandboxSettings: fullSettings, updatedAt: new Date().toISOString() }
      await window.electronAPI.profiles.save(updatedProfile)
      const updated = await window.electronAPI.profiles.list()
      setProfiles(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Save error:', err)
      alert('Failed to save sandbox settings.')
    } finally {
      setSaving(false)
    }
  }

  // Import SandboxVars.lua from file
  const handleImport = async () => {
    try {
      const filePath = await window.electronAPI.dialog.openFile({
        filters: [{ name: 'Lua Files', extensions: ['lua'] }, { name: 'All Files', extensions: ['*'] }]
      })
      if (!filePath) return
      const fileResult = await window.electronAPI.fs.readFile(filePath)
      if (!fileResult.success || !fileResult.content) {
        setImportMsg('Failed to read file: ' + (fileResult.message || 'Unknown error'))
        setTimeout(() => setImportMsg(''), 4000)
        return
      }
      // Parse SandboxVars.lua format
      const parsed: SandboxSettings = {}
      const zombieParsed: SandboxSettings = {}
      let inZombieConfig = false
      fileResult.content.split('\n').forEach((line: string) => {
        const t = line.trim()
        if (t.includes('ZombieConfig')) { inZombieConfig = true; return }
        if (inZombieConfig && t === '}') { inZombieConfig = false; return }
        const m = t.match(/^(\w+)\s*=\s*(.+?),?\s*$/)
        if (!m) return
        const [, key, rawVal] = m
        let val: unknown = rawVal
        if (rawVal === 'true') val = true
        else if (rawVal === 'false') val = false
        else if (!isNaN(Number(rawVal))) val = Number(rawVal)
        else val = rawVal.replace(/^"|"$/g, '')
        if (inZombieConfig) zombieParsed[key] = val
        else parsed[key] = val
      })
      setSettings(prev => ({ ...prev, ...parsed }))
      if (Object.keys(zombieParsed).length > 0) setZombieConfig(prev => ({ ...prev, ...zombieParsed }))
      setImportMsg(`Imported ${Object.keys(parsed).length} sandbox settings`)
      setTimeout(() => setImportMsg(''), 4000)
    } catch (err) {
      setImportMsg('Failed to import SandboxVars file')
      setTimeout(() => setImportMsg(''), 4000)
    }
  }

  // Export SandboxVars.lua to file
  const handleExport = async () => {
    try {
      const serverName = profile?.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'server'
      const fullSettings = { ...settings, ZombieConfig: zombieConfig }
      // Build Lua format
      const lines = ['SandboxVars = {']
      Object.entries(fullSettings).forEach(([k, v]) => {
        if (k === 'ZombieConfig') return
        if (typeof v === 'boolean') lines.push(`\t${k} = ${v},`)
        else if (typeof v === 'number') lines.push(`\t${k} = ${v},`)
        else lines.push(`\t${k} = "${v}",`)
      })
      lines.push('\tZombieConfig = {')
      Object.entries(zombieConfig).forEach(([k, v]) => {
        if (typeof v === 'boolean') lines.push(`\t\t${k} = ${v},`)
        else if (typeof v === 'number') lines.push(`\t\t${k} = ${v},`)
        else lines.push(`\t\t${k} = "${v}",`)
      })
      lines.push('\t},')
      lines.push('}')
      const content = lines.join('\n')
      const savePath = await window.electronAPI.dialog.saveFile({
        defaultPath: `${serverName}_SandboxVars.lua`,
        filters: [{ name: 'Lua Files', extensions: ['lua'] }]
      })
      if (!savePath) return
      await window.electronAPI.fs.writeFile(savePath, content)
      setImportMsg('SandboxVars exported successfully')
      setTimeout(() => setImportMsg(''), 4000)
    } catch (err) {
      setImportMsg('Failed to export SandboxVars file')
      setTimeout(() => setImportMsg(''), 4000)
    }
  }

  const tabs = [
    { id: 'zombies', label: 'Zombies' },
    { id: 'loot', label: 'Loot' },
    { id: 'world', label: 'World' },
    { id: 'player', label: 'Player' },
    { id: 'events', label: 'Events' },
    { id: 'vehicles', label: 'Vehicles' },
    ...(isB42 ? [{ id: 'b42', label: 'B42 (Animals/Crafting)' }] : []),
    { id: 'advanced', label: 'Advanced' },
  ] as const

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-pz-border bg-pz-darker flex-shrink-0">
        <button onClick={() => setActiveView('editor')} className="btn-ghost p-1.5">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-pz-text">Sandbox Settings</h1>
          <p className="text-xs text-pz-muted">
            {profile?.name} — {isB42 ? 'Build 42' : 'Build 41'} — Configure gameplay rules
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleImport} className="btn-outline text-xs" title="Import from SandboxVars.lua">
            <Upload size={12} /> Import
          </button>
          <button onClick={handleExport} className="btn-outline text-xs" title="Export to SandboxVars.lua">
            <Download size={12} /> Export
          </button>
          <button onClick={resetToDefaults} className="btn-outline text-xs" title="Reset all settings to default values">
            <RotateCcw size={12} /> Reset Defaults
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            <Save size={14} />
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>

      {/* Import/export message */}
      {importMsg && (
        <div className="px-6 py-2 bg-pz-green/10 border-b border-pz-green/20 text-xs text-pz-green flex-shrink-0">
          {importMsg}
        </div>
      )}

      {/* Search bar */}
      <div className="px-6 py-2 border-b border-pz-border bg-pz-darker flex items-center gap-2 flex-shrink-0">
        <Search size={14} className="text-pz-muted flex-shrink-0" />
        <input
          type="text"
          placeholder="Search settings…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm text-pz-text placeholder:text-pz-muted outline-none"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-pz-muted hover:text-pz-text">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Presets */}
      <div className="px-6 py-3 border-b border-pz-border bg-pz-darker flex items-center gap-3 flex-shrink-0 overflow-x-auto">
        <span className="text-xs text-pz-muted flex-shrink-0">Presets:</span>
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button key={key} onClick={() => applyPreset(key as keyof typeof PRESETS)}
            className="btn-outline text-xs flex-shrink-0" title={preset.description}>
            {preset.label}
          </button>
        ))}
      </div>

      {/* Tabs — hidden when searching */}
      {!searchLower && (
        <div className="flex gap-0 border-b border-pz-border bg-pz-darker px-6 flex-shrink-0 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === t.id ? 'tab-active' : 'tab-inactive'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* ── SEARCH RESULTS ── */}
          {searchLower && (
            <SBSection title={`Search results for "${searchQuery}"`}>
              <SearchResults query={searchLower} settings={settings} zombieConfig={zombieConfig} set={set} setZC={setZC} get={get} getZC={getZC} isB42={isB42} />
            </SBSection>
          )}

          {/* ── ZOMBIES TAB ── */}
          {tab === 'zombies' && (
            <>
              <SBSection title="Population">
                <SelectField label="Zombie Population" value={Number(get('Zombies', 4))} onChange={v => set('Zombies', v)}
                  options={[[1,'Insane'],[2,'Very High'],[3,'High'],[4,'Normal'],[5,'Low'],[6,'None']]} />
                <SelectField label="Distribution" value={Number(get('Distribution', 1))} onChange={v => set('Distribution', v)}
                  options={[[1,'Urban Focused'],[2,'Uniform']]} />
                <SliderField label="Population Start Multiplier" value={Number(getZC('PopulationStartMultiplier', 1.0))}
                  onChange={v => setZC('PopulationStartMultiplier', v)} min={0.1} max={4.0} step={0.1}
                  description="Population level on day 1" />
                <SliderField label="Population Peak Multiplier" value={Number(getZC('PopulationPeakMultiplier', 1.5))}
                  onChange={v => setZC('PopulationPeakMultiplier', v)} min={0.1} max={4.0} step={0.1}
                  description="Population at peak day" />
                <SliderField label="Population Peak Day" value={Number(getZC('PopulationPeakDay', 28))}
                  onChange={v => setZC('PopulationPeakDay', v)} min={1} max={365} step={1}
                  description="In-game day when population hits its peak" />
                <SliderField label="Redistribute Hours" value={Number(getZC('RedistributeHours', 12))}
                  onChange={v => setZC('RedistributeHours', v)} min={0} max={720} step={1}
                  description="Hours between zombie redistribution passes" />
              </SBSection>

              <SBSection title="Zombie Behavior">
                <SelectField label="Speed" value={Number(getZC('Speed', 3))} onChange={v => setZC('Speed', v)}
                  options={[[1,'Sprinters'],[2,'Fast Shamblers'],[3,'Shamblers'],[4,'Random']]} />
                <SelectField label="Strength" value={Number(getZC('Strength', 2))} onChange={v => setZC('Strength', v)}
                  options={[[1,'Superhuman'],[2,'Normal'],[3,'Weak'],[4,'Random']]} />
                <SelectField label="Toughness" value={Number(getZC('Toughness', 2))} onChange={v => setZC('Toughness', v)}
                  options={[[1,'Tough'],[2,'Normal'],[3,'Fragile'],[4,'Random']]} />
                <SelectField label="Cognition" value={Number(getZC('Intelligence', 2))} onChange={v => setZC('Intelligence', v)}
                  options={[[1,'Navigate + Use Doors'],[2,'Navigate'],[3,'Basic'],[4,'Random']]} />
                <SelectField label="Memory" value={Number(getZC('Memory', 2))} onChange={v => setZC('Memory', v)}
                  options={[[1,'Long'],[2,'Normal'],[3,'Short'],[4,'None']]} />
                <SelectField label="Sight" value={Number(getZC('Sight', 2))} onChange={v => setZC('Sight', v)}
                  options={[[1,'Eagle'],[2,'Normal'],[3,'Poor']]} />
                <SelectField label="Hearing" value={Number(getZC('Hearing', 2))} onChange={v => setZC('Hearing', v)}
                  options={[[1,'Pinpoint'],[2,'Normal'],[3,'Poor']]} />
                <SelectField label="Smell" value={Number(getZC('Smell', 2))} onChange={v => setZC('Smell', v)}
                  options={[[1,'Bloodhound'],[2,'Normal'],[3,'Poor']]} />
                <SliderField label="Follow Sound Distance" value={Number(getZC('FollowSoundDistance', 100))}
                  onChange={v => setZC('FollowSoundDistance', v)} min={10} max={1000} step={10}
                  description="Tiles a zombie will travel toward a sound" />
                <SliderField label="Rally Group Size" value={Number(getZC('RallyGroupSize', 20))}
                  onChange={v => setZC('RallyGroupSize', v)} min={1} max={1000} step={1}
                  description="Max zombies in a rally group" />
                <SliderField label="Rally Travel Distance" value={Number(getZC('RallyTravelDistance', 20))}
                  onChange={v => setZC('RallyTravelDistance', v)} min={5} max={1000} step={1} />
                <SliderField label="Rally Group Separation" value={Number(getZC('RallyGroupSeparation', 15))}
                  onChange={v => setZC('RallyGroupSeparation', v)} min={5} max={25} step={1} />
                <SliderField label="Rally Group Radius" value={Number(getZC('RallyGroupRadius', 3))}
                  onChange={v => setZC('RallyGroupRadius', v)} min={1} max={10} step={1} />
              </SBSection>

              <SBSection title="Infection & Respawn">
                <SelectField label="Transmission" value={Number(getZC('Transmission', 2))} onChange={v => setZC('Transmission', v)}
                  options={[[1,'Blood + Saliva'],[2,'Saliva Only'],[3,"Everyone's Infected"],[4,'None']]} />
                <SelectField label="Decomposition" value={Number(getZC('Decomp', 1))} onChange={v => setZC('Decomp', v)}
                  options={[[1,'Slow'],[2,'Normal'],[3,'Fast'],[4,'Instant']]} />
                <SliderField label="Respawn Hours (0=never)" value={Number(getZC('RespawnHours', 72))}
                  onChange={v => setZC('RespawnHours', v)} min={0} max={8760} step={1}
                  description="In-game hours before zombies respawn in cleared areas" />
                <SliderField label="Respawn Unseen Hours" value={Number(getZC('RespawnUnseenHours', 16))}
                  onChange={v => setZC('RespawnUnseenHours', v)} min={0} max={8760} step={1}
                  description="Hours a chunk must be unseen before zombies can respawn" />
                <SliderField label="Respawn Multiplier" value={Number(getZC('RespawnMultiplier', 0.1))}
                  onChange={v => setZC('RespawnMultiplier', v)} min={0.01} max={1.0} step={0.01}
                  description="Percentage of peak population that respawns each cycle" />
              </SBSection>

              <SBSection title="Special Behaviors">
                <ToggleField label="Crawl Under Vehicles" value={Number(getZC('CrawlUnderVehicle', 1)) === 1}
                  onChange={v => setZC('CrawlUnderVehicle', v ? 1 : 0)}
                  description="Zombies can crawl under vehicles to attack players" />
                <ToggleField label="Thump on Construction" value={!!getZC('ThumpOnConstruction', true)}
                  onChange={v => setZC('ThumpOnConstruction', v)}
                  description="Zombies attack player-built structures" />
                <ToggleField label="Thump No Chasing" value={!!getZC('ThumpNoChasing', false)}
                  onChange={v => setZC('ThumpNoChasing', v)}
                  description="Zombies only thump if they can see the player" />
                <ToggleField label="Active Only When Seen" value={!!getZC('ActiveOnly', false)}
                  onChange={v => setZC('ActiveOnly', v)}
                  description="Zombies only move when a player is nearby (performance mode)" />
                <ToggleField label="Trigger House Alarms" value={!!getZC('TriggerHouseAlarm', false)}
                  onChange={v => setZC('TriggerHouseAlarm', v)}
                  description="Zombies can trigger house alarms when entering" />
                <ToggleField label="Don't Attack Unless Threatened" value={!!getZC('ZombiesDontAttackUnlessThreatened', false)}
                  onChange={v => setZC('ZombiesDontAttackUnlessThreatened', v)}
                  description="Zombies only attack when player gets very close" />
                <ToggleField label="Disable Fake Dead" value={!!getZC('DisableFakeDead', false)}
                  onChange={v => setZC('DisableFakeDead', v)}
                  description="Disable zombies lying down pretending to be dead" />
              </SBSection>
            </>
          )}

          {/* ── LOOT TAB ── */}
          {tab === 'loot' && (
            <>
              <SBSection title="Loot Rarity">
                {[
                  ['FoodLoot', 'Food Loot'],
                  ['CannedFoodLoot', 'Canned Food'],
                  ['WeaponLoot', 'Melee Weapons'],
                  ['RangedWeaponLoot', 'Ranged Weapons'],
                  ['AmmoLoot', 'Ammunition'],
                  ['MedicalLoot', 'Medical Supplies'],
                  ['SurvivalGearsLoot', 'Survival Gear'],
                  ['LiteratureLoot', 'Literature / Books'],
                  ['MechanicsLoot', 'Mechanics / Tools'],
                  ['OtherLoot', 'Other Items'],
                ].map(([key, label]) => (
                  <SelectField key={key} label={label} value={Number(get(key, 4))} onChange={v => set(key, v)}
                    options={[[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']]} />
                ))}
              </SBSection>

              <SBSection title="Loot Respawn">
                <SelectField label="Loot Respawn" value={Number(get('LootRespawn', 1))} onChange={v => set('LootRespawn', v)}
                  options={[[1,'None'],[2,'Every Day'],[3,'Every Week'],[4,'Every Month']]} />
                <SliderField label="Seen Hours Prevent Loot Respawn" value={Number(get('SeenHoursPreventLootRespawn', 0))}
                  onChange={v => set('SeenHoursPreventLootRespawn', v)} min={0} max={8760} step={1}
                  description="0 = loot always respawns. Higher = loot won't respawn in recently visited areas." />
              </SBSection>
            </>
          )}

          {/* ── WORLD TAB ── */}
          {tab === 'world' && (
            <>
              <SBSection title="Time">
                <SelectField label="Day Length" value={Number(get('DayLength', 3))} onChange={v => set('DayLength', v)}
                  options={[[1,'15 Minutes'],[2,'30 Minutes'],[3,'1 Hour'],[4,'2 Hours'],[5,'3 Hours'],[6,'4 Hours'],[7,'5 Hours'],[8,'6 Hours'],[14,'12 Hours'],[18,'16 Hours'],[25,'Real Time']]} />
                <SelectField label="Start Year" value={Number(get('StartYear', 1))} onChange={v => set('StartYear', v)}
                  options={Array.from({length:5},(_,i)=>[i+1, `Year ${i+1}`] as [number,string])} />
                <SelectField label="Start Month" value={Number(get('StartMonth', 7))} onChange={v => set('StartMonth', v)}
                  options={[[1,'January'],[2,'February'],[3,'March'],[4,'April'],[5,'May'],[6,'June'],[7,'July'],[8,'August'],[9,'September'],[10,'October'],[11,'November'],[12,'December']]} />
                <SliderField label="Start Day" value={Number(get('StartDay', 1))}
                  onChange={v => set('StartDay', v)} min={1} max={31} step={1} />
                <SelectField label="Start Time" value={Number(get('StartTime', 2))} onChange={v => set('StartTime', v)}
                  options={[[1,'7 AM'],[2,'9 AM'],[3,'12 PM'],[4,'2 PM'],[5,'5 PM'],[6,'9 PM'],[7,'12 AM'],[8,'2 AM'],[9,'5 AM']]} />
                <SelectField label="Night Length" value={Number(get('NightLength', 3))} onChange={v => set('NightLength', v)}
                  options={[[1,'Always Night'],[2,'Long'],[3,'Normal'],[4,'Short']]} />
                <SelectField label="Night Darkness" value={Number(get('NightDarkness', 3))} onChange={v => set('NightDarkness', v)}
                  options={[[1,'Pitch Black'],[2,'Dark'],[3,'Normal'],[4,'Bright']]} />
              </SBSection>

              <SBSection title="Utilities">
                <SelectField label="Water Shutoff" value={Number(get('WaterShut', 2))} onChange={v => set('WaterShut', v)}
                  options={[[1,'Instant'],[2,'0-30 Days'],[3,'0-2 Months'],[4,'0-6 Months'],[5,'0-1 Year'],[6,'0-5 Years'],[7,'Never']]} />
                <SelectField label="Electricity Shutoff" value={Number(get('ElecShut', 2))} onChange={v => set('ElecShut', v)}
                  options={[[1,'Instant'],[2,'0-30 Days'],[3,'0-2 Months'],[4,'0-6 Months'],[5,'0-1 Year'],[6,'0-5 Years'],[7,'Never']]} />
                <SliderField label="Water Shutoff Day (override, -1=instant, 0=use interval)" value={Number(get('WaterShutModifier', 14))}
                  onChange={v => set('WaterShutModifier', v)} min={-1} max={365} step={1} />
                <SliderField label="Electricity Shutoff Day (override, -1=instant, 0=use interval)" value={Number(get('ElecShutModifier', 14))}
                  onChange={v => set('ElecShutModifier', v)} min={-1} max={365} step={1} />
              </SBSection>

              <SBSection title="Environment">
                <SelectField label="Temperature" value={Number(get('Temperature', 3))} onChange={v => set('Temperature', v)}
                  options={[[1,'Very Cold'],[2,'Cold'],[3,'Normal'],[4,'Hot'],[5,'Very Hot']]} />
                <SelectField label="Rain" value={Number(get('Rain', 3))} onChange={v => set('Rain', v)}
                  options={[[1,'Very Dry'],[2,'Dry'],[3,'Normal'],[4,'Rainy'],[5,'Very Rainy']]} />
                <SelectField label="Erosion Speed" value={Number(get('ErosionSpeed', 3))} onChange={v => set('ErosionSpeed', v)}
                  options={[[1,'Very Fast (20 days)'],[2,'Fast (50 days)'],[3,'Normal (100 days)'],[4,'Slow (200 days)'],[5,'Very Slow (500 days)']]} />
                <SliderField label="Erosion Days (0=use speed above)" value={Number(get('ErosionDays', 0))}
                  onChange={v => set('ErosionDays', v)} min={0} max={36500} step={1} />
                <SelectField label="Time Since Apocalypse" value={Number(get('TimeSinceApo', 1))} onChange={v => set('TimeSinceApo', v)}
                  options={Array.from({length:12},(_,i)=>[i+1, `${i} Month${i!==1?'s':''}`] as [number,string])} />
                <ToggleField label="Fire Spread" value={!!get('FireSpread', true)} onChange={v => set('FireSpread', v)}
                  description="Allow fire to spread to nearby tiles and buildings" />
                <ToggleField label="Enable Snow on Ground" value={!!get('EnableSnowOnGround', true)} onChange={v => set('EnableSnowOnGround', v)}
                  description="Snow accumulates on ground during winter" />
                <SelectField label="Max Fog Intensity" value={Number(get('MaxFogIntensity', 1))} onChange={v => set('MaxFogIntensity', v)}
                  options={[[1,'Normal'],[2,'Moderate'],[3,'Dense']]} />
                <SelectField label="Max Rain FX Intensity" value={Number(get('MaxRainFxIntensity', 1))} onChange={v => set('MaxRainFxIntensity', v)}
                  options={[[1,'Normal'],[2,'Moderate'],[3,'Heavy']]} />
              </SBSection>
            </>
          )}

          {/* ── PLAYER TAB ── */}
          {tab === 'player' && (
            <>
              <SBSection title="Progression">
                <SliderField label="XP Multiplier" value={Number(get('XpMultiplier', 1.0))}
                  onChange={v => set('XpMultiplier', v)} min={0.1} max={10.0} step={0.1}
                  description="1.0 = normal. 2.0 = double XP gain." />
                <ToggleField label="XP Multiplier Affects Passive Skills" value={!!get('XpMultiplierAffectsPassive', false)}
                  onChange={v => set('XpMultiplierAffectsPassive', v)}
                  description="Apply multiplier to Fitness and Strength (passive skills)" />
                <SliderField label="Free Character Points" value={Number(get('CharacterFreePoints', 0))}
                  onChange={v => set('CharacterFreePoints', v)} min={-100} max={100} step={1}
                  description="Extra points during character creation" />
                <ToggleField label="Starter Kit" value={!!get('StarterKit', false)} onChange={v => set('StarterKit', v)}
                  description="Spawn with chips, water, school bag, baseball bat, and hammer" />
                <ToggleField label="All Clothes Unlocked" value={!!get('AllClothesUnlocked', false)} onChange={v => set('AllClothesUnlocked', v)}
                  description="All clothing items available from character creation" />
              </SBSection>

              <SBSection title="Survival">
                <SelectField label="Stats Decrease Speed" value={Number(get('StatsDecrease', 3))} onChange={v => set('StatsDecrease', v)}
                  options={[[1,'Very Fast'],[2,'Fast'],[3,'Normal'],[4,'Slow'],[5,'Very Slow']]} />
                <ToggleField label="Nutrition System" value={!!get('Nutrition', true)} onChange={v => set('Nutrition', v)}
                  description="Nutritional value of food affects player condition" />
                <SelectField label="Food Rot Speed" value={Number(get('FoodRotSpeed', 3))} onChange={v => set('FoodRotSpeed', v)}
                  options={[[1,'Very Fast'],[2,'Fast'],[3,'Normal'],[4,'Slow'],[5,'Very Slow']]} />
                <SelectField label="Fridge Factor" value={Number(get('FridgeFactor', 3))} onChange={v => set('FridgeFactor', v)}
                  options={[[1,'Very Low'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']]} />
                <SelectField label="Endurance Regen" value={Number(get('EndRegen', 3))} onChange={v => set('EndRegen', v)}
                  options={[[1,'Very Fast'],[2,'Fast'],[3,'Normal'],[4,'Slow'],[5,'Very Slow']]} />
                <SliderField label="Zombie Attraction Multiplier" value={Number(get('ZombieAttractionMultiplier', 1.0))}
                  onChange={v => set('ZombieAttractionMultiplier', v)} min={0.0} max={10.0} step={0.1}
                  description="Multiplier for how much noise/smell players emit" />
                <ToggleField label="Enable Tainted Water Text" value={!!get('EnableTaintedWaterText', true)} onChange={v => set('EnableTaintedWaterText', v)}
                  description="Show 'tainted water' warning when drinking from ponds/puddles" />
              </SBSection>

              <SBSection title="Injury">
                <SelectField label="Injury Severity" value={Number(get('InjurySeverity', 2))} onChange={v => set('InjurySeverity', v)}
                  options={[[1,'Low'],[2,'Normal'],[3,'High']]} />
                <ToggleField label="Bone Fractures" value={!!get('BoneFracture', true)} onChange={v => set('BoneFracture', v)}
                  description="Broken limbs from falls, zombie damage, and vehicle impacts" />
                <SelectField label="Rear Vulnerability" value={Number(get('RearVulnerability', 3))} onChange={v => set('RearVulnerability', v)}
                  options={[[1,'Low'],[2,'Medium'],[3,'High']]} />
                <ToggleField label="Attack Block Movements" value={!!get('AttackBlockMovements', true)} onChange={v => set('AttackBlockMovements', v)}
                  description="Movement is impeded while performing melee attacks" />
                <ToggleField label="Multi-Hit Zombies" value={!!get('MultiHitZombies', false)} onChange={v => set('MultiHitZombies', v)}
                  description="Certain melee weapons can hit multiple zombies per swing" />
              </SBSection>

              <SBSection title="Farming & Nature">
                <SelectField label="Farming Speed" value={Number(get('Farming', 3))} onChange={v => set('Farming', v)}
                  options={[[1,'Very Fast'],[2,'Fast'],[3,'Normal'],[4,'Slow'],[5,'Very Slow']]} />
                <SelectField label="Nature Abundance" value={Number(get('NatureAbundance', 3))} onChange={v => set('NatureAbundance', v)}
                  options={[[1,'Very Poor'],[2,'Poor'],[3,'Normal'],[4,'Abundant'],[5,'Very Abundant']]} />
                <SelectField label="Plant Resilience" value={Number(get('PlantResilience', 3))} onChange={v => set('PlantResilience', v)}
                  options={[[1,'Very High'],[2,'High'],[3,'Normal'],[4,'Low'],[5,'Very Low']]} />
                <SelectField label="Plant Abundance" value={Number(get('PlantAbundance', 3))} onChange={v => set('PlantAbundance', v)}
                  options={[[1,'Very Poor'],[2,'Poor'],[3,'Normal'],[4,'Abundant'],[5,'Very Abundant']]} />
                <SelectField label="Compost Time" value={Number(get('CompostTime', 2))} onChange={v => set('CompostTime', v)}
                  options={[[1,'1 Week'],[2,'2 Weeks'],[3,'3 Weeks'],[4,'4 Weeks'],[5,'6 Weeks'],[6,'8 Weeks'],[7,'10 Weeks']]} />
              </SBSection>
            </>
          )}

          {/* ── EVENTS TAB ── */}
          {tab === 'events' && (
            <>
              <SBSection title="Meta Events">
                <SelectField label="Helicopter Events" value={Number(get('Helicopter', 2))} onChange={v => set('Helicopter', v)}
                  options={[[1,'Never'],[2,'Once'],[3,'Sometimes'],[4,'Often']]} />
                <SelectField label="Meta Events (Gunshots etc.)" value={Number(get('MetaEvent', 2))} onChange={v => set('MetaEvent', v)}
                  options={[[1,'Never'],[2,'Sometimes'],[3,'Often']]} />
                <SelectField label="Sleeping Events" value={Number(get('SleepingEvent', 1))} onChange={v => set('SleepingEvent', v)}
                  options={[[1,'Never'],[2,'Sometimes'],[3,'Often']]} />
              </SBSection>

              <SBSection title="World Spawns">
                <SelectField label="Generator Spawning" value={Number(get('GeneratorSpawning', 3))} onChange={v => set('GeneratorSpawning', v)}
                  options={[[1,'Extremely Rare'],[2,'Rare'],[3,'Sometimes'],[4,'Often']]} />
                <SliderField label="Generator Fuel Consumption" value={Number(get('GeneratorFuelConsumption', 1.0))}
                  onChange={v => set('GeneratorFuelConsumption', v)} min={0.1} max={10.0} step={0.1}
                  description="Fuel consumed per in-game hour" />
                <SelectField label="Survivor House Chance" value={Number(get('SurvivorHouseChance', 3))} onChange={v => set('SurvivorHouseChance', v)}
                  options={[[1,'Never'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']]} />
                <SelectField label="Vehicle Story Chance" value={Number(get('VehicleStoryChance', 3))} onChange={v => set('VehicleStoryChance', v)}
                  options={[[1,'Never'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']]} />
                <SelectField label="Zone Story Chance" value={Number(get('ZoneStoryChance', 3))} onChange={v => set('ZoneStoryChance', v)}
                  options={[[1,'Never'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']]} />
                <SelectField label="Annotated Map Chance" value={Number(get('AnnotatedMapChance', 4))} onChange={v => set('AnnotatedMapChance', v)}
                  options={[[1,'Never'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']]} />
              </SBSection>

              <SBSection title="Buildings">
                <SelectField label="Alarm Frequency" value={Number(get('Alarm', 6))} onChange={v => set('Alarm', v)}
                  options={[[1,'Never'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often'],[6,'Very Often']]} />
                <SelectField label="Locked Houses" value={Number(get('LockedHouses', 6))} onChange={v => set('LockedHouses', v)}
                  options={[[1,'Never'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often'],[6,'Very Often']]} />
              </SBSection>
            </>
          )}

          {/* ── VEHICLES TAB ── */}
          {tab === 'vehicles' && (
            <>
              <SBSection title="Spawning">
                <SelectField label="Car Spawn Rate" value={Number(get('CarSpawnRate', 3))} onChange={v => set('CarSpawnRate', v)}
                  options={[[1,'None'],[2,'Very Low'],[3,'Low'],[4,'Normal'],[5,'High']]} />
                <SelectField label="Initial Gas Level" value={Number(get('InitialGas', 4))} onChange={v => set('InitialGas', v)}
                  options={[[1,'Empty'],[2,'Very Low'],[3,'Low'],[4,'Normal'],[5,'High'],[6,'Full']]} />
                <SelectField label="Chance Has Gas" value={Number(get('ChanceHasGas', 4))} onChange={v => set('ChanceHasGas', v)}
                  options={[[1,'Very Low'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']]} />
                <SelectField label="Locked Cars" value={Number(get('LockedCar', 4))} onChange={v => set('LockedCar', v)}
                  options={[[1,'Never'],[2,'Rarely'],[3,'Sometimes'],[4,'Often'],[5,'Very Often']]} />
              </SBSection>

              <SBSection title="Mechanics">
                <SliderField label="Gas Consumption" value={Number(get('CarGasConsumption', 1.0))}
                  onChange={v => set('CarGasConsumption', v)} min={0.1} max={10.0} step={0.1}
                  description="Fuel consumption multiplier" />
                <SelectField label="Car Hotwire Chance" value={Number(get('CarHotwire', 4))} onChange={v => set('CarHotwire', v)}
                  options={[[1,'Very Low'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']]} />
                <SelectField label="Car Condition Affects Stats" value={Number(get('CarConditionAffectsStat', 3))} onChange={v => set('CarConditionAffectsStat', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']]} />
                <SelectField label="Car Damage on Impact" value={Number(get('CarDamageOnImpact', 3))} onChange={v => set('CarDamageOnImpact', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']]} />
                <SelectField label="Damage to Player from Car Hit" value={Number(get('DamageToPlayerFromHitByACar', 3))} onChange={v => set('DamageToPlayerFromHitByACar', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']]} />
              </SBSection>

              <SBSection title="Options">
                <ToggleField label="Easy Vehicle Use" value={!!get('VehicleEasyUse', false)} onChange={v => set('VehicleEasyUse', v)}
                  description="Cars are never locked and don't need keys" />
                <ToggleField label="Enable Vehicles" value={!!get('EnableVehicles', true)} onChange={v => set('EnableVehicles', v)}
                  description="Vehicles spawn in the world" />
                <ToggleField label="Enable Trailer Hitch" value={!!get('EnableTrailerHitch', true)} onChange={v => set('EnableTrailerHitch', v)}
                  description="Allow attaching trailers to vehicles" />
                <ToggleField label="Allow Exterior Generator" value={!!get('AllowExteriorGenerator', true)} onChange={v => set('AllowExteriorGenerator', v)}
                  description="Generators work on exterior tiles (e.g., power gas pumps)" />
              </SBSection>
            </>
          )}

          {/* ── B42 TAB (only shown for B42 profiles) ── */}
          {!searchLower && tab === 'b42' && isB42 && (
            <>
              <div className="bg-pz-green/10 border border-pz-green/20 rounded-lg p-3 text-xs text-pz-muted">
                These settings are exclusive to <strong className="text-pz-green">Build 42</strong> and will be ignored on B41 servers.
              </div>

              <SBSection title="Animal Population">
                <SliderField label="Animal Population Multiplier" value={Number(get('AnimalPopulationMultiplier', 1.0))}
                  onChange={v => set('AnimalPopulationMultiplier', v)} min={0.0} max={4.0} step={0.1}
                  description="Overall animal population multiplier" />
                <SliderField label="Population Start Multiplier" value={Number(get('AnimalPopulationStartMultiplier', 1.0))}
                  onChange={v => set('AnimalPopulationStartMultiplier', v)} min={0.0} max={4.0} step={0.1}
                  description="Animal population on day 1" />
                <SliderField label="Population Peak Multiplier" value={Number(get('AnimalPopulationPeakMultiplier', 1.5))}
                  onChange={v => set('AnimalPopulationPeakMultiplier', v)} min={0.0} max={4.0} step={0.1}
                  description="Animal population at peak day" />
                <SliderField label="Population Peak Day" value={Number(get('AnimalPopulationPeakDay', 28))}
                  onChange={v => set('AnimalPopulationPeakDay', v)} min={1} max={365} step={1} />
                <SelectField label="Chance Animals Spawn on Farms" value={Number(get('AnimalChanceSpawnOnFarm', 1))} onChange={v => set('AnimalChanceSpawnOnFarm', v)}
                  options={[[1,'Low'],[2,'Medium'],[3,'High']]} />
              </SBSection>

              <SBSection title="Animal Husbandry">
                <SliderField label="Aging Modifier Speed" value={Number(get('AgingModifierSpeed', 1.0))}
                  onChange={v => set('AgingModifierSpeed', v)} min={0.1} max={10.0} step={0.1}
                  description="How fast animals age (1.0 = normal)" />
                <SliderField label="Milk Increase Speed" value={Number(get('MilkIncreaseSpeed', 1.0))}
                  onChange={v => set('MilkIncreaseSpeed', v)} min={0.1} max={10.0} step={0.1}
                  description="How fast cows and goats produce milk" />
                <SliderField label="Wool Increase Speed" value={Number(get('WoolIncreaseSpeed', 1.0))}
                  onChange={v => set('WoolIncreaseSpeed', v)} min={0.1} max={10.0} step={0.1}
                  description="How fast sheep produce wool" />
              </SBSection>

              <SBSection title="Crafting">
                <SliderField label="Craft Multiplier" value={Number(get('CraftMultiplier', 1.0))}
                  onChange={v => set('CraftMultiplier', v)} min={0.1} max={10.0} step={0.1}
                  description="XP multiplier for crafting actions" />
                <SliderField label="Max Craftable Items on Ground (0=unlimited)" value={Number(get('MaxCraftableItemsOnGround', 0))}
                  onChange={v => set('MaxCraftableItemsOnGround', v)} min={0} max={9000} step={1}
                  description="Limit items that can be placed on the ground via crafting" />
              </SBSection>
            </>
          )}

          {/* ── ADVANCED TAB ── */}
          {!searchLower && tab === 'advanced' && (
            <>
              <SBSection title="Corpses & Blood">
                <SliderField label="Hours for Corpse Removal (-1=never)" value={Number(get('HoursForCorpseRemoval', 216))}
                  onChange={v => set('HoursForCorpseRemoval', v)} min={-1} max={8760} step={1}
                  description="Hours before zombie bodies disappear" />
                <SelectField label="Decaying Corpse Health Impact" value={Number(get('DecayingCorpseHealthImpact', 3))} onChange={v => set('DecayingCorpseHealthImpact', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']]} />
                <SelectField label="Blood Level" value={Number(get('BloodLevel', 3))} onChange={v => set('BloodLevel', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']]} />
                <SliderField label="Days for Rotten Food Removal (-1=never)" value={Number(get('DaysForRottenFoodRemoval', -1))}
                  onChange={v => set('DaysForRottenFoodRemoval', v)} min={-1} max={365} step={1} />
              </SBSection>

              <SBSection title="Clothing & Construction">
                <SelectField label="Clothing Degradation" value={Number(get('ClothingDegradation', 3))} onChange={v => set('ClothingDegradation', v)}
                  options={[[1,'Disabled'],[2,'Slow'],[3,'Normal'],[4,'Fast']]} />
                <SelectField label="Construction Bonus Points" value={Number(get('ConstructionBonusPoints', 3))} onChange={v => set('ConstructionBonusPoints', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']]} />
              </SBSection>
            </>
          )}

        </div>
      </div>
    </div>
  )
}

// ── SearchResults: flat list of all fields matching the query ──────────────────
type SearchResultsProps = {
  query: string
  settings: SandboxSettings
  zombieConfig: SandboxSettings
  set: (k: string, v: unknown) => void
  setZC: (k: string, v: unknown) => void
  get: (k: string, d: unknown) => unknown
  getZC: (k: string, d: unknown) => unknown
  isB42: boolean
}

type FieldDef =
  | { type: 'select'; label: string; key: string; zc?: boolean; options: [number, string][]; defaultVal: number }
  | { type: 'slider'; label: string; key: string; zc?: boolean; min: number; max: number; step: number; defaultVal: number; description?: string }
  | { type: 'toggle'; label: string; key: string; zc?: boolean; defaultVal: boolean; description?: string }

const ALL_FIELDS: FieldDef[] = [
  // Zombies
  { type: 'select', label: 'Zombie Population', key: 'Zombies', defaultVal: 4, options: [[1,'Insane'],[2,'Very High'],[3,'High'],[4,'Normal'],[5,'Low'],[6,'None']] },
  { type: 'select', label: 'Distribution', key: 'Distribution', defaultVal: 1, options: [[1,'Urban Focused'],[2,'Uniform']] },
  { type: 'slider', label: 'Population Start Multiplier', key: 'PopulationStartMultiplier', zc: true, min: 0.1, max: 4.0, step: 0.1, defaultVal: 1.0, description: 'Population level on day 1' },
  { type: 'slider', label: 'Population Peak Multiplier', key: 'PopulationPeakMultiplier', zc: true, min: 0.1, max: 4.0, step: 0.1, defaultVal: 1.5, description: 'Population at peak day' },
  { type: 'slider', label: 'Population Peak Day', key: 'PopulationPeakDay', zc: true, min: 1, max: 365, step: 1, defaultVal: 28, description: 'In-game day when population hits its peak' },
  { type: 'slider', label: 'Redistribute Hours', key: 'RedistributeHours', zc: true, min: 0, max: 720, step: 1, defaultVal: 12, description: 'Hours between zombie redistribution passes' },
  { type: 'select', label: 'Speed', key: 'Speed', zc: true, defaultVal: 3, options: [[1,'Sprinters'],[2,'Fast Shamblers'],[3,'Shamblers'],[4,'Random']] },
  { type: 'select', label: 'Strength', key: 'Strength', zc: true, defaultVal: 2, options: [[1,'Superhuman'],[2,'Normal'],[3,'Weak'],[4,'Random']] },
  { type: 'select', label: 'Toughness', key: 'Toughness', zc: true, defaultVal: 2, options: [[1,'Tough'],[2,'Normal'],[3,'Fragile'],[4,'Random']] },
  { type: 'select', label: 'Cognition', key: 'Intelligence', zc: true, defaultVal: 2, options: [[1,'Navigate + Use Doors'],[2,'Navigate'],[3,'Basic'],[4,'Random']] },
  { type: 'select', label: 'Memory', key: 'Memory', zc: true, defaultVal: 2, options: [[1,'Long'],[2,'Normal'],[3,'Short'],[4,'None']] },
  { type: 'select', label: 'Sight', key: 'Sight', zc: true, defaultVal: 2, options: [[1,'Eagle'],[2,'Normal'],[3,'Poor']] },
  { type: 'select', label: 'Hearing', key: 'Hearing', zc: true, defaultVal: 2, options: [[1,'Pinpoint'],[2,'Normal'],[3,'Poor']] },
  { type: 'select', label: 'Smell', key: 'Smell', zc: true, defaultVal: 2, options: [[1,'Bloodhound'],[2,'Normal'],[3,'Poor']] },
  { type: 'slider', label: 'Follow Sound Distance', key: 'FollowSoundDistance', zc: true, min: 10, max: 1000, step: 10, defaultVal: 100 },
  { type: 'slider', label: 'Rally Group Size', key: 'RallyGroupSize', zc: true, min: 1, max: 1000, step: 1, defaultVal: 20 },
  { type: 'slider', label: 'Rally Travel Distance', key: 'RallyTravelDistance', zc: true, min: 5, max: 1000, step: 1, defaultVal: 20 },
  { type: 'slider', label: 'Rally Group Separation', key: 'RallyGroupSeparation', zc: true, min: 5, max: 25, step: 1, defaultVal: 15 },
  { type: 'slider', label: 'Rally Group Radius', key: 'RallyGroupRadius', zc: true, min: 1, max: 10, step: 1, defaultVal: 3 },
  { type: 'select', label: 'Transmission', key: 'Transmission', zc: true, defaultVal: 2, options: [[1,'Blood + Saliva'],[2,'Saliva Only'],[3,"Everyone's Infected"],[4,'None']] },
  { type: 'select', label: 'Decomposition', key: 'Decomp', zc: true, defaultVal: 1, options: [[1,'Slow'],[2,'Normal'],[3,'Fast'],[4,'Instant']] },
  { type: 'slider', label: 'Respawn Hours (0=never)', key: 'RespawnHours', zc: true, min: 0, max: 8760, step: 1, defaultVal: 72 },
  { type: 'slider', label: 'Respawn Unseen Hours', key: 'RespawnUnseenHours', zc: true, min: 0, max: 8760, step: 1, defaultVal: 16 },
  { type: 'slider', label: 'Respawn Multiplier', key: 'RespawnMultiplier', zc: true, min: 0.01, max: 1.0, step: 0.01, defaultVal: 0.1 },
  { type: 'toggle', label: 'Crawl Under Vehicles', key: 'CrawlUnderVehicle', zc: true, defaultVal: true },
  { type: 'toggle', label: 'Thump on Construction', key: 'ThumpOnConstruction', zc: true, defaultVal: true },
  { type: 'toggle', label: 'Thump No Chasing', key: 'ThumpNoChasing', zc: true, defaultVal: false },
  { type: 'toggle', label: 'Active Only When Seen', key: 'ActiveOnly', zc: true, defaultVal: false },
  { type: 'toggle', label: 'Trigger House Alarms', key: 'TriggerHouseAlarm', zc: true, defaultVal: false },
  { type: 'toggle', label: "Don't Attack Unless Threatened", key: 'ZombiesDontAttackUnlessThreatened', zc: true, defaultVal: false },
  { type: 'toggle', label: 'Disable Fake Dead', key: 'DisableFakeDead', zc: true, defaultVal: false },
  // Loot
  { type: 'select', label: 'Food Loot', key: 'FoodLoot', defaultVal: 4, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Canned Food', key: 'CannedFoodLoot', defaultVal: 4, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Melee Weapons', key: 'WeaponLoot', defaultVal: 2, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Ranged Weapons', key: 'RangedWeaponLoot', defaultVal: 2, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Ammunition', key: 'AmmoLoot', defaultVal: 2, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Medical Supplies', key: 'MedicalLoot', defaultVal: 4, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Survival Gear', key: 'SurvivalGearsLoot', defaultVal: 4, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Literature / Books', key: 'LiteratureLoot', defaultVal: 4, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Mechanics / Tools', key: 'MechanicsLoot', defaultVal: 4, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Other Items', key: 'OtherLoot', defaultVal: 3, options: [[1,'None'],[2,'Insanely Rare'],[3,'Extremely Rare'],[4,'Rare'],[5,'Normal'],[6,'Common'],[7,'Abundant']] },
  { type: 'select', label: 'Loot Respawn', key: 'LootRespawn', defaultVal: 1, options: [[1,'None'],[2,'Every Day'],[3,'Every Week'],[4,'Every Month']] },
  { type: 'slider', label: 'Seen Hours Prevent Loot Respawn', key: 'SeenHoursPreventLootRespawn', min: 0, max: 8760, step: 1, defaultVal: 0 },
  // World
  { type: 'select', label: 'Day Length', key: 'DayLength', defaultVal: 3, options: [[1,'15 Minutes'],[2,'30 Minutes'],[3,'1 Hour'],[4,'2 Hours'],[5,'3 Hours'],[6,'4 Hours'],[7,'5 Hours'],[8,'6 Hours'],[14,'12 Hours'],[18,'16 Hours'],[25,'Real Time']] },
  { type: 'select', label: 'Start Year', key: 'StartYear', defaultVal: 1, options: [[1,'Year 1'],[2,'Year 2'],[3,'Year 3'],[4,'Year 4'],[5,'Year 5']] },
  { type: 'select', label: 'Start Month', key: 'StartMonth', defaultVal: 7, options: [[1,'January'],[2,'February'],[3,'March'],[4,'April'],[5,'May'],[6,'June'],[7,'July'],[8,'August'],[9,'September'],[10,'October'],[11,'November'],[12,'December']] },
  { type: 'slider', label: 'Start Day', key: 'StartDay', min: 1, max: 31, step: 1, defaultVal: 1 },
  { type: 'select', label: 'Start Time', key: 'StartTime', defaultVal: 2, options: [[1,'7 AM'],[2,'9 AM'],[3,'12 PM'],[4,'2 PM'],[5,'5 PM'],[6,'9 PM'],[7,'12 AM'],[8,'2 AM'],[9,'5 AM']] },
  { type: 'select', label: 'Night Length', key: 'NightLength', defaultVal: 3, options: [[1,'Always Night'],[2,'Long'],[3,'Normal'],[4,'Short']] },
  { type: 'select', label: 'Night Darkness', key: 'NightDarkness', defaultVal: 3, options: [[1,'Pitch Black'],[2,'Dark'],[3,'Normal'],[4,'Bright']] },
  { type: 'select', label: 'Water Shutoff', key: 'WaterShut', defaultVal: 2, options: [[1,'Instant'],[2,'0-30 Days'],[3,'0-2 Months'],[4,'0-6 Months'],[5,'0-1 Year'],[6,'0-5 Years'],[7,'Never']] },
  { type: 'select', label: 'Electricity Shutoff', key: 'ElecShut', defaultVal: 2, options: [[1,'Instant'],[2,'0-30 Days'],[3,'0-2 Months'],[4,'0-6 Months'],[5,'0-1 Year'],[6,'0-5 Years'],[7,'Never']] },
  { type: 'slider', label: 'Water Shutoff Day Override', key: 'WaterShutModifier', min: -1, max: 365, step: 1, defaultVal: 14 },
  { type: 'slider', label: 'Electricity Shutoff Day Override', key: 'ElecShutModifier', min: -1, max: 365, step: 1, defaultVal: 14 },
  { type: 'select', label: 'Temperature', key: 'Temperature', defaultVal: 3, options: [[1,'Very Cold'],[2,'Cold'],[3,'Normal'],[4,'Hot'],[5,'Very Hot']] },
  { type: 'select', label: 'Rain', key: 'Rain', defaultVal: 3, options: [[1,'Very Dry'],[2,'Dry'],[3,'Normal'],[4,'Rainy'],[5,'Very Rainy']] },
  { type: 'select', label: 'Erosion Speed', key: 'ErosionSpeed', defaultVal: 3, options: [[1,'Very Fast (20 days)'],[2,'Fast (50 days)'],[3,'Normal (100 days)'],[4,'Slow (200 days)'],[5,'Very Slow (500 days)']] },
  { type: 'slider', label: 'Erosion Days', key: 'ErosionDays', min: 0, max: 36500, step: 1, defaultVal: 0 },
  { type: 'select', label: 'Time Since Apocalypse', key: 'TimeSinceApo', defaultVal: 1, options: [[1,'0 Months'],[2,'1 Month'],[3,'2 Months'],[4,'3 Months'],[5,'4 Months'],[6,'5 Months'],[7,'6 Months'],[8,'7 Months'],[9,'8 Months'],[10,'9 Months'],[11,'10 Months'],[12,'11 Months']] },
  { type: 'toggle', label: 'Fire Spread', key: 'FireSpread', defaultVal: true },
  { type: 'toggle', label: 'Enable Snow on Ground', key: 'EnableSnowOnGround', defaultVal: true },
  { type: 'select', label: 'Max Fog Intensity', key: 'MaxFogIntensity', defaultVal: 1, options: [[1,'Normal'],[2,'Moderate'],[3,'Dense']] },
  { type: 'select', label: 'Max Rain FX Intensity', key: 'MaxRainFxIntensity', defaultVal: 1, options: [[1,'Normal'],[2,'Moderate'],[3,'Heavy']] },
  // Player
  { type: 'slider', label: 'XP Multiplier', key: 'XpMultiplier', min: 0.1, max: 10.0, step: 0.1, defaultVal: 1.0 },
  { type: 'toggle', label: 'XP Multiplier Affects Passive Skills', key: 'XpMultiplierAffectsPassive', defaultVal: false },
  { type: 'slider', label: 'Free Character Points', key: 'CharacterFreePoints', min: -100, max: 100, step: 1, defaultVal: 0 },
  { type: 'slider', label: 'Construction Bonus Points', key: 'ConstructionBonusPoints', min: 0, max: 100, step: 1, defaultVal: 3 },
  { type: 'toggle', label: 'Starter Kit', key: 'StarterKit', defaultVal: false },
  { type: 'toggle', label: 'Nutrition System', key: 'Nutrition', defaultVal: true },
  { type: 'select', label: 'Food Rot Speed', key: 'FoodRotSpeed', defaultVal: 3, options: [[1,'Very Fast'],[2,'Fast'],[3,'Normal'],[4,'Slow'],[5,'Very Slow']] },
  { type: 'select', label: 'Fridge Factor', key: 'FridgeFactor', defaultVal: 3, options: [[1,'Very Low'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']] },
  { type: 'select', label: 'Stats Decrease Speed', key: 'StatsDecrease', defaultVal: 3, options: [[1,'Very Fast'],[2,'Fast'],[3,'Normal'],[4,'Slow'],[5,'Very Slow']] },
  { type: 'select', label: 'Injury Severity', key: 'InjurySeverity', defaultVal: 2, options: [[1,'Low'],[2,'Normal'],[3,'High']] },
  { type: 'toggle', label: 'Bone Fracture', key: 'BoneFracture', defaultVal: true },
  { type: 'toggle', label: 'All Clothes Unlocked', key: 'AllClothesUnlocked', defaultVal: false },
  { type: 'toggle', label: 'Enable Tainted Water Text', key: 'EnableTaintedWaterText', defaultVal: true },
  { type: 'select', label: 'Rear Vulnerability', key: 'RearVulnerability', defaultVal: 3, options: [[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']] },
  { type: 'toggle', label: 'Attack Block Movements', key: 'AttackBlockMovements', defaultVal: true },
  { type: 'toggle', label: 'Multi-Hit Zombies', key: 'MultiHitZombies', defaultVal: false },
  // Events
  { type: 'select', label: 'Helicopter Events', key: 'Helicopter', defaultVal: 2, options: [[1,'Never'],[2,'Sometimes'],[3,'Often']] },
  { type: 'select', label: 'Meta Events', key: 'MetaEvent', defaultVal: 2, options: [[1,'Never'],[2,'Sometimes'],[3,'Often']] },
  { type: 'select', label: 'Sleeping Events', key: 'SleepingEvent', defaultVal: 1, options: [[1,'Never'],[2,'Sometimes'],[3,'Often']] },
  { type: 'select', label: 'Survivor House Chance', key: 'SurvivorHouseChance', defaultVal: 3, options: [[1,'None'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']] },
  { type: 'select', label: 'Vehicle Story Chance', key: 'VehicleStoryChance', defaultVal: 3, options: [[1,'None'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']] },
  { type: 'select', label: 'Zone Story Chance', key: 'ZoneStoryChance', defaultVal: 3, options: [[1,'None'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']] },
  { type: 'select', label: 'Annotated Map Chance', key: 'AnnotatedMapChance', defaultVal: 4, options: [[1,'None'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']] },
  { type: 'select', label: 'Generator Spawning', key: 'GeneratorSpawning', defaultVal: 3, options: [[1,'None'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often']] },
  { type: 'slider', label: 'Generator Fuel Consumption', key: 'GeneratorFuelConsumption', min: 0.1, max: 10.0, step: 0.1, defaultVal: 1.0 },
  { type: 'toggle', label: 'Allow Exterior Generator', key: 'AllowExteriorGenerator', defaultVal: true },
  { type: 'select', label: 'Nature Abundance', key: 'NatureAbundance', defaultVal: 3, options: [[1,'Very Low'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']] },
  { type: 'select', label: 'Alarm Frequency', key: 'Alarm', defaultVal: 6, options: [[1,'Never'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often'],[6,'Very Often']] },
  { type: 'select', label: 'Locked Houses', key: 'LockedHouses', defaultVal: 6, options: [[1,'Never'],[2,'Extremely Rare'],[3,'Rare'],[4,'Sometimes'],[5,'Often'],[6,'Very Often']] },
  // Vehicles
  { type: 'toggle', label: 'Enable Vehicles', key: 'EnableVehicles', defaultVal: true },
  { type: 'toggle', label: 'Enable Trailer Hitch', key: 'EnableTrailerHitch', defaultVal: true },
  { type: 'toggle', label: 'Easy Vehicle Use', key: 'VehicleEasyUse', defaultVal: false },
  { type: 'select', label: 'Car Spawn Rate', key: 'CarSpawnRate', defaultVal: 3, options: [[1,'None'],[2,'Very Low'],[3,'Low'],[4,'Normal'],[5,'High'],[6,'Very High']] },
  { type: 'select', label: 'Chance Has Gas', key: 'ChanceHasGas', defaultVal: 4, options: [[1,'Very Low'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']] },
  { type: 'select', label: 'Initial Gas', key: 'InitialGas', defaultVal: 4, options: [[1,'Very Low'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Full']] },
  { type: 'slider', label: 'Car Gas Consumption', key: 'CarGasConsumption', min: 0.1, max: 10.0, step: 0.1, defaultVal: 1.0 },
  { type: 'select', label: 'Locked Car Chance', key: 'LockedCar', defaultVal: 4, options: [[1,'Never'],[2,'Rarely'],[3,'Sometimes'],[4,'Often'],[5,'Very Often']] },
  { type: 'select', label: 'Car Hotwire Difficulty', key: 'CarHotwire', defaultVal: 4, options: [[1,'Very Easy'],[2,'Easy'],[3,'Normal'],[4,'Hard'],[5,'Very Hard']] },
  { type: 'select', label: 'Car Condition Affects Stats', key: 'CarConditionAffectsStat', defaultVal: 3, options: [[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']] },
  { type: 'select', label: 'Car Damage on Impact', key: 'CarDamageOnImpact', defaultVal: 3, options: [[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']] },
  { type: 'select', label: 'Player Damage from Car Hit', key: 'DamageToPlayerFromHitByACar', defaultVal: 3, options: [[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']] },
  // Advanced
  { type: 'slider', label: 'Hours for Corpse Removal (-1=never)', key: 'HoursForCorpseRemoval', min: -1, max: 8760, step: 1, defaultVal: 216 },
  { type: 'select', label: 'Decaying Corpse Health Impact', key: 'DecayingCorpseHealthImpact', defaultVal: 3, options: [[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']] },
  { type: 'select', label: 'Blood Level', key: 'BloodLevel', defaultVal: 3, options: [[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']] },
  { type: 'select', label: 'Clothing Degradation', key: 'ClothingDegradation', defaultVal: 3, options: [[1,'None'],[2,'Slow'],[3,'Normal'],[4,'Fast']] },
  { type: 'slider', label: 'Days for Rotten Food Removal (-1=never)', key: 'DaysForRottenFoodRemoval', min: -1, max: 365, step: 1, defaultVal: -1 },
  { type: 'slider', label: 'Hours for World Item Removal', key: 'HoursForWorldItemRemoval', min: 0, max: 8760, step: 1, defaultVal: 24 },
  { type: 'toggle', label: 'Item Removal Blacklist Toggle', key: 'ItemRemovalListBlacklistToggle', defaultVal: false },
  { type: 'slider', label: 'Zombie Attraction Multiplier', key: 'ZombieAttractionMultiplier', min: 0.1, max: 10.0, step: 0.1, defaultVal: 1.0 },
  // B42
  { type: 'slider', label: 'Animal Population Multiplier', key: 'AnimalPopulationMultiplier', min: 0.0, max: 4.0, step: 0.1, defaultVal: 1.0 },
  { type: 'slider', label: 'Animal Population Start Multiplier', key: 'AnimalPopulationStartMultiplier', min: 0.0, max: 4.0, step: 0.1, defaultVal: 1.0 },
  { type: 'slider', label: 'Animal Population Peak Multiplier', key: 'AnimalPopulationPeakMultiplier', min: 0.0, max: 4.0, step: 0.1, defaultVal: 1.5 },
  { type: 'slider', label: 'Animal Population Peak Day', key: 'AnimalPopulationPeakDay', min: 1, max: 365, step: 1, defaultVal: 28 },
  { type: 'select', label: 'Animal Chance Spawn on Farm', key: 'AnimalChanceSpawnOnFarm', defaultVal: 1, options: [[0,'Never'],[1,'Rare'],[2,'Sometimes'],[3,'Often']] },
  { type: 'slider', label: 'Aging Modifier Speed', key: 'AgingModifierSpeed', min: 0.1, max: 5.0, step: 0.1, defaultVal: 1.0 },
  { type: 'slider', label: 'Milk Increase Speed', key: 'MilkIncreaseSpeed', min: 0.1, max: 5.0, step: 0.1, defaultVal: 1.0 },
  { type: 'slider', label: 'Wool Increase Speed', key: 'WoolIncreaseSpeed', min: 0.1, max: 5.0, step: 0.1, defaultVal: 1.0 },
  { type: 'slider', label: 'Craft Multiplier', key: 'CraftMultiplier', min: 0.1, max: 10.0, step: 0.1, defaultVal: 1.0 },
  { type: 'slider', label: 'Max Craftable Items on Ground', key: 'MaxCraftableItemsOnGround', min: 0, max: 1000, step: 1, defaultVal: 0 },
]

function SearchResults({ query, set, setZC, get, getZC }: SearchResultsProps) {
  const matches = ALL_FIELDS.filter(f => f.label.toLowerCase().includes(query) || f.key.toLowerCase().includes(query))
  if (matches.length === 0) return <p className="text-sm text-pz-muted py-2">No settings found matching "{query}"</p>
  return (
    <div className="space-y-4">
      {matches.map(f => {
        const getter = f.zc ? getZC : get
        const setter = f.zc ? setZC : set
        if (f.type === 'select') {
          return <SelectField key={f.key} label={f.label} value={Number(getter(f.key, f.defaultVal))} onChange={v => setter(f.key, v)} options={f.options} />
        } else if (f.type === 'slider') {
          return <SliderField key={f.key} label={f.label} value={Number(getter(f.key, f.defaultVal))} onChange={v => setter(f.key, v)} min={f.min} max={f.max} step={f.step} description={f.description} />
        } else {
          return <ToggleField key={f.key} label={f.label} value={!!getter(f.key, f.defaultVal)} onChange={v => setter(f.key, v)} description={f.description} />
        }
      })}
    </div>
  )
}

function SBSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-4">
      <h2 className="section-title border-b border-pz-border pb-2">{title}</h2>
      {children}
    </div>
  )
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: number; onChange: (v: number) => void; options: [number, string][]
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-pz-text flex-1">{label}</label>
      <select value={value} onChange={e => onChange(Number(e.target.value))} className="select w-48 flex-shrink-0">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

function SliderField({ label, value, onChange, min, max, step, description }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; description?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm text-pz-text">{label}</label>
        <span className="text-sm font-mono text-pz-green w-16 text-right">{value}</span>
      </div>
      <input type="range" value={value} onChange={e => onChange(Number(e.target.value))}
        min={min} max={max} step={step} className="w-full" />
      {description && <p className="text-xs text-pz-muted mt-1">{description}</p>}
    </div>
  )
}

function ToggleField({ label, value, onChange, description }: {
  label: string; value: boolean; onChange: (v: boolean) => void; description?: string
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <div className="text-sm text-pz-text">{label}</div>
        {description && <div className="text-xs text-pz-muted">{description}</div>}
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-pz-green' : 'bg-pz-border'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}
