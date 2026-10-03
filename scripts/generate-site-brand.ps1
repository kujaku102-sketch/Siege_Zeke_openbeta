Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot 'src/assets/siege-zeke-logo-static.png'
$assetRoot = Join-Path $projectRoot 'public/assets'
$source = [System.Drawing.Image]::FromFile($sourcePath)

function Export-LogoCrop {
    param(
        [string] $Name,
        [int] $Width,
        [int] $Height,
        [System.Drawing.Rectangle] $Crop,
        [int] $Inset = 0
    )
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $availableWidth = $Width - 2 * $Inset
        $availableHeight = $Height - 2 * $Inset
        $scale = [Math]::Min($availableWidth / $Crop.Width, $availableHeight / $Crop.Height)
        $drawWidth = [int] [Math]::Round($Crop.Width * $scale)
        $drawHeight = [int] [Math]::Round($Crop.Height * $scale)
        $target = [System.Drawing.Rectangle]::new([int](($Width - $drawWidth) / 2), [int](($Height - $drawHeight) / 2), $drawWidth, $drawHeight)
        $graphics.DrawImage($source, $target, $Crop, [System.Drawing.GraphicsUnit]::Pixel)
        $bitmap.Save((Join-Path $assetRoot $Name), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

try {
    # The favicon uses the S from the exact FX-OFF logo; the share card uses its full wordmark.
    $symbol = [System.Drawing.Rectangle]::new(1280, 1230, 860, 1000)
    $wordmark = [System.Drawing.Rectangle]::new(300, 1160, 5600, 2510)
    Export-LogoCrop 'site-icon-32.png' 32 32 $symbol 2
    Export-LogoCrop 'app-icon-192.png' 192 192 $symbol 14
    Export-LogoCrop 'app-icon-512.png' 512 512 $symbol 38
    Export-LogoCrop 'site-share-1200x630.png' 1200 630 $wordmark 34
} finally {
    $source.Dispose()
}
