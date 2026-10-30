# SpecDeck from the released AppImage. release.json holds the version and hash; the release
# workflow updates it after each release.
{
  lib,
  appimageTools,
  fetchurl,
}:

let
  release = lib.importJSON ./release.json;
  pname = "specdeck";
  inherit (release) version;

  src = fetchurl {
    url = "https://github.com/nickhartjes/specdeck/releases/download/v${version}/SpecDeck-x86_64.AppImage";
    inherit (release) hash;
  };

  contents = appimageTools.extract { inherit pname version src; };
in
appimageTools.wrapType2 {
  inherit pname version src;

  extraInstallCommands = ''
    install -Dm444 ${contents}/specdeck.desktop $out/share/applications/specdeck.desktop
    substituteInPlace $out/share/applications/specdeck.desktop \
      --replace-fail 'Exec=AppRun' 'Exec=specdeck'
    cp -r ${contents}/usr/share/icons $out/share/icons
  '';

  meta = {
    description = "Share a Claude Code session with your team";
    homepage = "https://github.com/nickhartjes/specdeck";
    license = lib.licenses.mit;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "specdeck";
  };
}
