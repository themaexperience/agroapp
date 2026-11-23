Add-Type -AssemblyName System.Drawing

$srcLogo = [System.Drawing.Bitmap]::FromFile("public/logo-san-jose.png")

function Generate-Icon($size, $destPath, $contentScale = 0.76) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    # Fondo 100% blanco puro
    $g.Clear([System.Drawing.Color]::White)
    
    # Calcular dimensiones con aspecto original centrado dentro de safe zone
    $targetSize = [int]($size * $contentScale)
    $aspect = $srcLogo.Width / $srcLogo.Height
    
    if ($aspect -ge 1.0) {
        $destW = $targetSize
        $destH = [int]($targetSize / $aspect)
    } else {
        $destH = $targetSize
        $destW = [int]($targetSize * $aspect)
    }
    
    $destX = [int](($size - $destW) / 2)
    $destY = [int](($size - $destH) / 2)
    
    $destRect = New-Object System.Drawing.Rectangle $destX, $destY, $destW, $destH
    $g.DrawImage($srcLogo, $destRect, 0, 0, $srcLogo.Width, $srcLogo.Height, [System.Drawing.GraphicsUnit]::Pixel)
    
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Generado: $destPath (${size}x${size}, contenido: ${destW}x${destH} en ($destX,$destY))"
}

Generate-Icon 512 "public/icon-512.png" 0.76
Generate-Icon 192 "public/icon-192.png" 0.76
Generate-Icon 180 "public/apple-touch-icon.png" 0.78

$srcLogo.Dispose()
Write-Output "Íconos PWA generados con éxito sobre fondo blanco limpio."
