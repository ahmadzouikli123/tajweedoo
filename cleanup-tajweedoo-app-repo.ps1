# Run from inside the tajweedoo-app repo root.
# Only deletes items confirmed as untracked by git status — zero risk to committed history.
$root = "$env:USERPROFILE\Downloads\tajweedoo-app"
Set-Location $root

$itemsToDelete = @(
    "tajweedoo",
    "appwrite-function",
    "appwrite-function-extracted",
    "main.js",
    "backup-tool.zip",
    "add-function-bucket-config.ps1",
    "add-function-variables.ps1",
    "organize-tajweedoo-v2.ps1"
)

foreach ($item in $itemsToDelete) {
    $path = Join-Path $root $item
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force
        Write-Host "Deleted: $item"
    } else {
        Write-Host "Not found (already clean): $item"
    }
}

Write-Host "`nRemaining git status:"
git status
