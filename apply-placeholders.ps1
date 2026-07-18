$path = ".\index.html"

if (-not (Test-Path $path)) {
    Write-Error "index.html not found. cd into tajweedoo-app folder first."
    exit 1
}

Copy-Item $path "$path.bak-placeholders" -Force
Write-Host "Backup saved as index.html.bak-placeholders"

$content = Get-Content $path -Raw -Encoding UTF8

$replacements = @{
    ".setEndpoint('https://tor.cloud.appwrite.io/v1')" = ".setEndpoint('__APPWRITE_ENDPOINT__')"
    ".setProject('6a4427890005bbbf6529')"               = ".setProject('__APPWRITE_PROJECT_ID__')"
    "const RECITATIONS_BUCKET_ID = '6a4bf8e60030884d5c2b';" = "const RECITATIONS_BUCKET_ID = '__RECITATIONS_BUCKET_ID__';"
    "const SECURITY_FUNCTION_ID = '6a4ca5580022c9c96e89';"  = "const SECURITY_FUNCTION_ID = '__SECURITY_FUNCTION_ID__';"
    "const DB_ID = '6a4427a80035fe6e174d';"                 = "const DB_ID = '__APPWRITE_DATABASE_ID__';"
}

$appliedCount = 0
foreach ($old in $replacements.Keys) {
    $new = $replacements[$old]
    if ($content.Contains($old)) {
        $content = $content.Replace($old, $new)
        Write-Host "Replaced: $old" -ForegroundColor Green
        $appliedCount++
    } else {
        Write-Warning "NOT FOUND (skipped): $old"
    }
}

if ($appliedCount -gt 0) {
    Set-Content $path $content -Encoding UTF8 -NoNewline
    Write-Host "`nDone. $appliedCount of 5 replacements applied." -ForegroundColor Cyan
} else {
    Write-Warning "No replacements applied - file unchanged."
}
