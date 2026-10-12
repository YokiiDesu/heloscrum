param([Parameter(Mandatory=$true)][string]$TargetPath, [switch]$Directory)
$ErrorActionPreference = 'Stop'
# A Node process started by PowerShell 7 inherits its module search path.
# Windows PowerShell must load its own Security module, not the Core version.
$env:PSModulePath = "$PSHOME\Modules"
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($Directory) {
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
} else {
  $acl = [System.Security.AccessControl.FileSecurity]::new()
  $inherit = [System.Security.AccessControl.InheritanceFlags]::None
}
$acl.SetOwner($identity)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($identity, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inherit, 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $TargetPath -AclObject $acl
