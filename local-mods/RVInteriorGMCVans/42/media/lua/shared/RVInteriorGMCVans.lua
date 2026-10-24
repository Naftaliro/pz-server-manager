-- Gives the '83 GMC vans the same interior as vanilla vans in [B42]PROJECT RV Interior.
-- Both vans have TrunkDoor / DoorRearRight, which the "normal" type already accepts.

local GMC_VANS = {
    "Base.83gmcG1500lwb",
    "Base.83gmcG1500aTeam",
}

local function addGMCVans()
    local ok, RV = pcall(require, "RVVehicleTypes")
    if not ok or not RV or not RV.VehicleTypes or not RV.VehicleTypes["normal"] then return end
    local scripts = RV.VehicleTypes["normal"].scripts

    for _, name in ipairs(GMC_VANS) do
        local listed = false
        for _, existing in ipairs(scripts) do
            if existing == name then listed = true break end
        end
        if not listed then table.insert(scripts, name) end
    end
end

Events.OnInitWorld.Add(addGMCVans)
