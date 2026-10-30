{
  description = "SpecDeck: share a Claude Code session with your team";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  # Only x86_64-linux: the package wraps the released x86_64 AppImage (nix/package.nix).
  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      specdeck = pkgs.callPackage ./nix/package.nix { };
    in
    {
      packages.${system} = {
        default = specdeck;
        inherit specdeck;
      };

      apps.${system}.default = {
        type = "app";
        program = "${specdeck}/bin/specdeck";
        inherit (specdeck) meta;
      };

      overlays.default = final: prev: {
        specdeck = final.callPackage ./nix/package.nix { };
      };
    };
}
