import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useLoaderManager } from "./useLoaderManager";
import { prepColorTexture, prepDataTexture } from "./loaders";

// Sea-surface maps + the perlin noise driving fogone/fogtwo — loaded ONCE
// here and shared (same texture instances, like Scene.jsx's seaMaps/fogNoise
// closures) by every scene's own water/fog ShaderMaterial instances.
const SEA_BASECOLOR_URL = "/textures/waterwavetex/basecolor.png";
const SEA_NORMAL_URL = "/textures/waterwavetex/normalmap.png";
const SEA_DISPLACEMENT_URL = "/textures/waterwavetex/displacement.png";
const SEA_AO_URL = "/textures/waterwavetex/ambientocculsion.png";
const SEA_ORM_URL = "/textures/waterwavetex/orm.png";
const SEA_TRANSMISSION_URL = "/textures/waterwavetex/transmission.png";
const FOG_NOISE_URL = "/textures/perlin.png";

export function useSharedMaps() {
  const { gl } = useThree();
  const manager = useLoaderManager();
  const [maps, setMaps] = useState(null);

  useEffect(() => {
    let disposed = false;
    const textureLoader = new THREE.TextureLoader(manager);

    Promise.all([
      textureLoader.loadAsync(SEA_BASECOLOR_URL),
      textureLoader.loadAsync(SEA_NORMAL_URL),
      textureLoader.loadAsync(SEA_DISPLACEMENT_URL),
      textureLoader.loadAsync(SEA_AO_URL),
      textureLoader.loadAsync(SEA_ORM_URL),
      textureLoader.loadAsync(SEA_TRANSMISSION_URL),
      textureLoader.loadAsync(FOG_NOISE_URL),
    ]).then(([baseColor, normal, displacement, ao, orm, transmission, fogNoise]) => {
      if (disposed) return;
      prepColorTexture(baseColor, gl);
      prepDataTexture(normal, gl);
      prepDataTexture(displacement, gl);
      prepDataTexture(ao, gl);
      prepDataTexture(orm, gl);
      prepDataTexture(transmission, gl);
      prepDataTexture(fogNoise, gl);
      setMaps({
        seaMaps: { baseColor, normal, displacement, ao, orm, transmission },
        fogNoise,
      });
    });

    return () => {
      disposed = true;
    };
  }, [gl, manager]);

  return maps; // null until every shared map has loaded
}
