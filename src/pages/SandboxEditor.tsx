import { useState, useEffect } from 'react'
import { Save, ArrowLeft, RotateCcw } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

type SandboxSettings = Record<string, unknown>

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
  const [tab, setTab] = useState<'zombies' | 'loot' | 'world' | 'player' | 'events' | 'advanced'>('zombies')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const profile = profiles.find(p => p.id === activeProfileId)

  useEffect(() => {
    if (profile) {
      const s = profile.sandboxSettings || {}
      const zc = (s.ZombieConfig as SandboxSettings) || {}
      setSettings(s)
      setZombieConfig(zc)
    }
  }, [activeProfileId])

  const set = (key: string, value: unknown) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const setZC = (key: string, value: unknown) => {
    setZombieConfig(prev => ({ ...prev, [key]: value }))
  }

  const get = (key: string, fallback: unknown) => {
    return settings[key] !== undefined ? settings[key] : fallback
  }

  const getZC = (key: string, fallback: unknown) => {
    return zombieConfig[key] !== undefined ? zombieConfig[key] : fallback
  }

  const applyPreset = (presetKey: keyof typeof PRESETS) => {
    const preset = PRESETS[presetKey]
    const { ZombieConfig, ...rest } = preset.settings as { ZombieConfig?: SandboxSettings } & SandboxSettings
    setSettings(prev => ({ ...prev, ...rest }))
    if (ZombieConfig) {
      setZombieConfig(prev => ({ ...prev, ...ZombieConfig }))
    }
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const fullSettings = { ...settings, ZombieConfig: zombieConfig }
      const serverName = profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')
      const dataPath = `%USERPROFILE%\\Zomboid`

      await window.electronAPI.config.writeSandbox(serverName, dataPath, fullSettings)

      // Update profile in store
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

  const tabs = [
    { id: 'zombies', label: 'Zombies' },
    { id: 'loot', label: 'Loot' },
    { id: 'world', label: 'World' },
    { id: 'player', label: 'Player' },
    { id: 'events', label: 'Events' },
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
          <p className="text-xs text-pz-muted">{profile?.name} — Configure gameplay rules</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          <Save size={14} />
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      {/* Presets */}
      <div className="px-6 py-3 border-b border-pz-border bg-pz-darker flex items-center gap-3 flex-shrink-0 overflow-x-auto">
        <span className="text-xs text-pz-muted flex-shrink-0">Presets:</span>
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button
            key={key}
            onClick={() => applyPreset(key as keyof typeof PRESETS)}
            className="btn-outline text-xs flex-shrink-0"
            title={preset.description}
          >
            <RotateCcw size={12} />
            {preset.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-pz-border bg-pz-darker px-6 flex-shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id ? 'tab-active' : 'tab-inactive'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Zombies Tab */}
          {tab === 'zombies' && (
            <>
              <SBSection title="Population">
                <SelectField label="Zombie Population" value={Number(get('Zombies', 4))} onChange={v => set('Zombies', v)}
                  options={[
                    [1, 'Insane'], [2, 'Very High'], [3, 'High'], [4, 'Normal'], [5, 'Low'], [6, 'None']
                  ]} />
                <SelectField label="Distribution" value={Number(get('Distribution', 1))} onChange={v => set('Distribution', v)}
                  options={[[1, 'Urban Focused'], [2, 'Uniform']]} />
                <SliderField label="Population Start Multiplier" value={Number(getZC('PopulationStartMultiplier', 1.0))}
                  onChange={v => setZC('PopulationStartMultiplier', v)} min={0.1} max={4.0} step={0.1}
                  description="Population level on day 1" />
                <SliderField label="Population Peak Multiplier" value={Number(getZC('PopulationPeakMultiplier', 1.5))}
                  onChange={v => setZC('PopulationPeakMultiplier', v)} min={0.1} max={4.0} step={0.1}
                  description="Population at peak day" />
                <SliderField label="Population Peak Day" value={Number(getZC('PopulationPeakDay', 28))}
                  onChange={v => setZC('PopulationPeakDay', v)} min={1} max={365} step={1}
                  description="In-game day when population hits its peak" />
              </SBSection>

              <SBSection title="Zombie Behavior">
                <SelectField label="Speed" value={Number(getZC('Speed', 3))} onChange={v => setZC('Speed', v)}
                  options={[[1, 'Sprinters'], [2, 'Fast Shamblers'], [3, 'Shamblers'], [4, 'Random']]} />
                <SelectField label="Strength" value={Number(getZC('Strength', 2))} onChange={v => setZC('Strength', v)}
                  options={[[1, 'Superhuman'], [2, 'Normal'], [3, 'Weak'], [4, 'Random']]} />
                <SelectField label="Toughness" value={Number(getZC('Toughness', 2))} onChange={v => setZC('Toughness', v)}
                  options={[[1, 'Tough'], [2, 'Normal'], [3, 'Fragile'], [4, 'Random']]} />
                <SelectField label="Cognition" value={Number(getZC('Intelligence', 2))} onChange={v => setZC('Intelligence', v)}
                  options={[[1, 'Navigate + Use Doors'], [2, 'Navigate'], [3, 'Basic'], [4, 'Random']]} />
                <SelectField label="Memory" value={Number(getZC('Memory', 2))} onChange={v => setZC('Memory', v)}
                  options={[[1, 'Long'], [2, 'Normal'], [3, 'Short'], [4, 'None']]} />
                <SelectField label="Sight" value={Number(getZC('Sight', 2))} onChange={v => setZC('Sight', v)}
                  options={[[1, 'Eagle'], [2, 'Normal'], [3, 'Poor']]} />
                <SelectField label="Hearing" value={Number(getZC('Hearing', 2))} onChange={v => setZC('Hearing', v)}
                  options={[[1, 'Pinpoint'], [2, 'Normal'], [3, 'Poor']]} />
              </SBSection>

              <SBSection title="Infection & Respawn">
                <SelectField label="Transmission" value={Number(getZC('Transmission', 2))} onChange={v => setZC('Transmission', v)}
                  options={[[1, 'Blood + Saliva'], [2, 'Saliva Only'], [3, "Everyone's Infected"], [4, 'None']]} />
                <SliderField label="Respawn Hours (0=never)" value={Number(getZC('RespawnHours', 72))}
                  onChange={v => setZC('RespawnHours', v)} min={0} max={8760} step={1}
                  description="In-game hours before zombies respawn in cleared areas" />
                <SliderField label="Respawn Unseen Hours" value={Number(getZC('RespawnUnseenHours', 16))}
                  onChange={v => setZC('RespawnUnseenHours', v)} min={0} max={8760} step={1}
                  description="Hours a chunk must be unseen before zombies can respawn" />
                <SliderField label="Respawn Multiplier" value={Number(getZC('RespawnMultiplier', 0.1))}
                  onChange={v => setZC('RespawnMultiplier', v)} min={0.01} max={1.0} step={0.01}
                  description="Percentage of peak population that respawns each cycle" />
                <ToggleField label="Crawl Under Vehicles" value={Number(getZC('CrawlUnderVehicle', 1)) === 1}
                  onChange={v => setZC('CrawlUnderVehicle', v ? 1 : 0)}
                  description="Zombies can crawl under vehicles to attack players" />
                <ToggleField label="Thump on Construction" value={!!getZC('ThumpOnConstruction', true)}
                  onChange={v => setZC('ThumpOnConstruction', v)}
                  description="Zombies attack player-built structures" />
              </SBSection>
            </>
          )}

          {/* Loot Tab */}
          {tab === 'loot' && (
            <>
              <SBSection title="Loot Rarity">
                {[
                  ['FoodLoot', 'Food Loot'],
                  ['CannedFoodLoot', 'Canned Food'],
                  ['WeaponLoot', 'Weapons'],
                  ['RangedWeaponLoot', 'Ranged Weapons'],
                  ['AmmoLoot', 'Ammunition'],
                  ['MedicalLoot', 'Medical Supplies'],
                  ['SurvivalGearsLoot', 'Survival Gear'],
                  ['LiteratureLoot', 'Literature / Books'],
                  ['MechanicsLoot', 'Mechanics'],
                  ['OtherLoot', 'Other Items'],
                ].map(([key, label]) => (
                  <SelectField key={key} label={label} value={Number(get(key, 4))} onChange={v => set(key, v)}
                    options={[
                      [1, 'None'], [2, 'Insanely Rare'], [3, 'Extremely Rare'],
                      [4, 'Rare'], [5, 'Normal'], [6, 'Common'], [7, 'Abundant']
                    ]} />
                ))}
              </SBSection>

              <SBSection title="Loot Respawn">
                <SelectField label="Loot Respawn" value={Number(get('LootRespawn', 1))} onChange={v => set('LootRespawn', v)}
                  options={[[1, 'None'], [2, 'Every Day'], [3, 'Every Week'], [4, 'Every Month']]} />
                <SliderField label="Seen Hours Prevent Loot Respawn" value={Number(get('SeenHoursPreventLootRespawn', 0))}
                  onChange={v => set('SeenHoursPreventLootRespawn', v)} min={0} max={8760} step={1}
                  description="0 = loot always respawns. Higher = loot won't respawn in recently visited areas." />
              </SBSection>
            </>
          )}

          {/* World Tab */}
          {tab === 'world' && (
            <>
              <SBSection title="Time">
                <SelectField label="Day Length" value={Number(get('DayLength', 3))} onChange={v => set('DayLength', v)}
                  options={[
                    [1, '15 Minutes'], [2, '30 Minutes'], [3, '1 Hour'], [4, '2 Hours'],
                    [5, '3 Hours'], [6, '4 Hours'], [7, '5 Hours'], [8, '6 Hours'],
                    [14, '12 Hours'], [18, '16 Hours'], [25, 'Real Time']
                  ]} />
                <SelectField label="Start Month" value={Number(get('StartMonth', 7))} onChange={v => set('StartMonth', v)}
                  options={[
                    [1,'January'],[2,'February'],[3,'March'],[4,'April'],[5,'May'],[6,'June'],
                    [7,'July'],[8,'August'],[9,'September'],[10,'October'],[11,'November'],[12,'December']
                  ]} />
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
                <SliderField label="Water Shutoff Day (override)" value={Number(get('WaterShutModifier', 14))}
                  onChange={v => set('WaterShutModifier', v)} min={-1} max={365} step={1}
                  description="-1 = instant, 0 = use interval above" />
                <SliderField label="Electricity Shutoff Day (override)" value={Number(get('ElecShutModifier', 14))}
                  onChange={v => set('ElecShutModifier', v)} min={-1} max={365} step={1}
                  description="-1 = instant, 0 = use interval above" />
              </SBSection>

              <SBSection title="Environment">
                <SelectField label="Temperature" value={Number(get('Temperature', 3))} onChange={v => set('Temperature', v)}
                  options={[[1,'Very Cold'],[2,'Cold'],[3,'Normal'],[4,'Hot'],[5,'Very Hot']]} />
                <SelectField label="Rain" value={Number(get('Rain', 3))} onChange={v => set('Rain', v)}
                  options={[[1,'Very Dry'],[2,'Dry'],[3,'Normal'],[4,'Rainy'],[5,'Very Rainy']]} />
                <SelectField label="Erosion Speed" value={Number(get('ErosionSpeed', 3))} onChange={v => set('ErosionSpeed', v)}
                  options={[[1,'Very Fast (20 days)'],[2,'Fast (50 days)'],[3,'Normal (100 days)'],[4,'Slow (200 days)'],[5,'Very Slow (500 days)']]} />
                <SelectField label="Time Since Apocalypse" value={Number(get('TimeSinceApo', 1))} onChange={v => set('TimeSinceApo', v)}
                  options={Array.from({length:12},(_,i)=>[i+1, `${i} Month${i!==1?'s':''}`])} />
                <ToggleField label="Fire Spread" value={!!get('FireSpread', true)} onChange={v => set('FireSpread', v)}
                  description="Allow fire to spread to nearby tiles and buildings" />
                <ToggleField label="Enable Snow on Ground" value={!!get('EnableSnowOnGround', true)} onChange={v => set('EnableSnowOnGround', v)}
                  description="Snow accumulates on ground during winter" />
              </SBSection>
            </>
          )}

          {/* Player Tab */}
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

          {/* Events Tab */}
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

          {/* Advanced Tab */}
          {tab === 'advanced' && (
            <>
              <SBSection title="Vehicles">
                <SelectField label="Car Spawn Rate" value={Number(get('CarSpawnRate', 3))} onChange={v => set('CarSpawnRate', v)}
                  options={[[1,'None'],[2,'Very Low'],[3,'Low'],[4,'Normal'],[5,'High']]} />
                <SelectField label="Initial Gas Level" value={Number(get('InitialGas', 4))} onChange={v => set('InitialGas', v)}
                  options={[[1,'Empty'],[2,'Very Low'],[3,'Low'],[4,'Normal'],[5,'High'],[6,'Full']]} />
                <SelectField label="Chance Has Gas" value={Number(get('ChanceHasGas', 4))} onChange={v => set('ChanceHasGas', v)}
                  options={[[1,'Very Low'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']]} />
                <SliderField label="Gas Consumption" value={Number(get('CarGasConsumption', 1.0))}
                  onChange={v => set('CarGasConsumption', v)} min={0.1} max={10.0} step={0.1}
                  description="Fuel consumption multiplier" />
                <SelectField label="Locked Cars" value={Number(get('LockedCar', 4))} onChange={v => set('LockedCar', v)}
                  options={[[1,'Never'],[2,'Rarely'],[3,'Sometimes'],[4,'Often'],[5,'Very Often']]} />
                <ToggleField label="Easy Vehicle Use" value={!!get('VehicleEasyUse', false)} onChange={v => set('VehicleEasyUse', v)}
                  description="Cars are never locked and don't need keys" />
                <ToggleField label="Enable Vehicles" value={!!get('EnableVehicles', true)} onChange={v => set('EnableVehicles', v)}
                  description="Vehicles spawn in the world" />
                <ToggleField label="Enable Trailer Hitch" value={!!get('EnableTrailerHitch', true)} onChange={v => set('EnableTrailerHitch', v)}
                  description="Allow attaching trailers to vehicles" />
              </SBSection>

              <SBSection title="Corpses & Blood">
                <SliderField label="Hours for Corpse Removal" value={Number(get('HoursForCorpseRemoval', 216))}
                  onChange={v => set('HoursForCorpseRemoval', v)} min={-1} max={8760} step={1}
                  description="-1 = never. Hours before zombie bodies disappear." />
                <SelectField label="Decaying Corpse Health Impact" value={Number(get('DecayingCorpseHealthImpact', 3))} onChange={v => set('DecayingCorpseHealthImpact', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']]} />
                <SelectField label="Blood Level" value={Number(get('BloodLevel', 3))} onChange={v => set('BloodLevel', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High']]} />
                <SliderField label="Days for Rotten Food Removal" value={Number(get('DaysForRottenFoodRemoval', -1))}
                  onChange={v => set('DaysForRottenFoodRemoval', v)} min={-1} max={365} step={1}
                  description="-1 = never removed" />
              </SBSection>

              <SBSection title="Clothing & Construction">
                <SelectField label="Clothing Degradation" value={Number(get('ClothingDegradation', 3))} onChange={v => set('ClothingDegradation', v)}
                  options={[[1,'Disabled'],[2,'Slow'],[3,'Normal'],[4,'Fast']]} />
                <ToggleField label="All Clothes Unlocked" value={!!get('AllClothesUnlocked', false)} onChange={v => set('AllClothesUnlocked', v)}
                  description="All clothing items available from character creation" />
                <SelectField label="Construction Bonus Points" value={Number(get('ConstructionBonusPoints', 3))} onChange={v => set('ConstructionBonusPoints', v)}
                  options={[[1,'None'],[2,'Low'],[3,'Normal'],[4,'High'],[5,'Very High']]} />
                <ToggleField label="Allow Exterior Generator" value={!!get('AllowExteriorGenerator', true)} onChange={v => set('AllowExteriorGenerator', v)}
                  description="Generators work on exterior tiles (e.g., power gas pumps)" />
              </SBSection>
            </>
          )}
        </div>
      </div>
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
  label: string
  value: number
  onChange: (v: number) => void
  options: [number, string][]
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-pz-text flex-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="select w-48 flex-shrink-0"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  )
}

function SliderField({ label, value, onChange, min, max, step, description }: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  description?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm text-pz-text">{label}</label>
        <span className="text-sm font-mono text-pz-green w-16 text-right">{value}</span>
      </div>
      <input
        type="range"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full"
      />
      {description && <p className="text-xs text-pz-muted mt-1">{description}</p>}
    </div>
  )
}

function ToggleField({ label, value, onChange, description }: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  description?: string
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <div className="text-sm text-pz-text">{label}</div>
        {description && <div className="text-xs text-pz-muted">{description}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
          value ? 'bg-pz-green' : 'bg-pz-border'
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  )
}
