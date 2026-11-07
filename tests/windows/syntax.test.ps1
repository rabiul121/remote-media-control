# Every script parses, the C# compiles, and the C# stays within C# 5.
# Windows PowerShell 5.1 (what the PC runs) compiles Add-Type code with C# 5. PowerShell 7 here would silently accept
# newer syntax, so each file is also compiled at language version 5 and any newer feature is reported.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$win = Join-Path $root 'windows'
$fail = 0

function Test-CSharp5([string]$source) {
    Add-Type -TypeDefinition 'public class SeedForRoslyn {}' -Language CSharp -ErrorAction SilentlyContinue
    $options = [Microsoft.CodeAnalysis.CSharp.CSharpParseOptions]::new([Microsoft.CodeAnalysis.CSharp.LanguageVersion]::CSharp5)
    $tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($source, $options)
    $reference = [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile([object].Assembly.Location)
    $compilation = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('check', [Microsoft.CodeAnalysis.SyntaxTree[]]@($tree),
        [Microsoft.CodeAnalysis.MetadataReference[]]@($reference),
        [Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions]::new([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary))
    @($compilation.GetDiagnostics() | Where-Object { $_.Severity -eq 'Error' -and $_.GetMessage() -match 'not available in C#|language version' })
}
# The checker must be able to fail, or its "ok" means nothing.
foreach ($bad in 'class A { int X => 1; }', 'class B { string F(string s){ return $"x{s}"; } }', 'class C { void F(object o){ var l = o?.ToString(); } }') {
    if ((Test-CSharp5 $bad).Count -eq 0) { $fail++; "CHECKER FAIL: did not flag newer syntax: $bad" }
}

foreach ($file in Get-ChildItem -LiteralPath $win -Filter *.ps1) {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { $fail++; "PARSE FAIL $($file.Name)"; $errors | ForEach-Object { "  line $($_.Extent.StartLineNumber): $($_.Message)" } } else { "parse ok    $($file.Name)" }
}
foreach ($name in 'Native.cs', 'Input.cs') {
    $source = Get-Content -Raw -LiteralPath (Join-Path $win $name)
    try { Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop; "compiles    $name" } catch { $fail++; "COMPILE FAIL $name :: $($_.Exception.Message)" }
    $newer = Test-CSharp5 $source
    if ($newer.Count) { $fail++; "C# 5 FAIL $name"; $newer | Select-Object -First 5 | ForEach-Object { "  $($_.Location.GetLineSpan().StartLinePosition): $($_.GetMessage())" } } else { "C# 5 ok     $name" }
}
if ($fail) { exit 1 }
