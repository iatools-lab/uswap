$files = (git status --porcelain) | ForEach-Object { $_.Substring(3).Trim('"') }

if (-not $files) {
    Write-Host "Aucune modification détectée." -ForegroundColor Yellow
    exit
}

foreach ($file in $files) {
    if (-not $file) { continue }
    
    $ext = [System.IO.Path]::GetExtension($file).ToLower()
    $name = [System.IO.Path]::GetFileName($file).ToLower()
    
    # Détection automatique du rôle du fichier
    if ($name -match 'readme|\.md$|license') { $role = "docs" }
    elseif ($name -match 'package\.json|requirements\.txt|\.env|\.gitignore') { $role = "chore" }
    elseif ($ext -in '.py','.js','.ts','.jsx','.tsx','.java','.c','.cpp') { $role = "feat" }
    elseif ($ext -in '.css','.scss','.html') { $role = "style" }
    else { $role = "chore" }

    # Ajout et commit individuel (syntaxe délimitée ${role})
    git add "$file"
    git commit -m "${role}: update $file"
}

# Envoi de tous les commits sur GitHub
git push origin dylane
