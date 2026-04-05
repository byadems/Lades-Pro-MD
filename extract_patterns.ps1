$patternRegex = [regex]::new('pattern:\s*["`'']([^"`'']+)["`'']')
$files = Get-ChildItem -Path 'plugins' -Filter '*.js' -File
$allPatterns = @()
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $matches = $patternRegex.Matches($content)
    foreach ($match in $matches) {
        $fullPattern = $match.Groups[1].Value
        $cmdName = ($fullPattern -split '\s+')[0]
        $allPatterns += [PSCustomObject]@{
            File = $file.Name
            FullPattern = $fullPattern
            CmdName = $cmdName
        }
    }
}
Write-Host '=== ALL PATTERNS ==='
Write-Host "Total: "
Write-Host ''
$allPatterns | Sort-Object CmdName, File | ForEach-Object {
    Write-Host "$($_.File) -> pattern: "$($_.FullPattern)" (cmd: $($_.CmdName))"
}
Write-Host ''
Write-Host '=== DUPLICATES ==='
$duplicates = $allPatterns | Group-Object CmdName | Where-Object { $_.Count -gt 1 }
foreach ($dup in $duplicates) {
    Write-Host "DUP: '$($dup.Name)' found 0 times:"
    foreach ($item in $dup.Group) {
        Write-Host "  - $($item.File) : pattern: "$($item.FullPattern)""
    }
}
