import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import type { ModelFileData, ModelComponent } from '../store/useStore';

export async function loadModel(
  file: ModelFileData,
  content: ArrayBuffer
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  switch (file.type) {
    case 'stl':
      return loadSTL(content, new STLLoader());
    case 'obj':
      return loadOBJ(content, new OBJLoader());
    case 'gltf':
    case 'glb':
      return loadGLTF(content, new GLTFLoader());
    case 'ply':
      return loadPLY(content, new PLYLoader());
    case '3mf':
      return load3MF(content, new ThreeMFLoader());
    case 'step':
    case 'stp':
      return loadSTEP(content);
    default:
      throw new Error(`Unsupported file type: ${file.type}`);
  }
}



async function loadSTL(
  content: ArrayBuffer,
  loader: STLLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    try {
      const geometry = loader.parse(content);
      const material = new THREE.MeshStandardMaterial({ 
        color: 0xc084fc,
        metalness: 0.1,
        roughness: 0.7,
        side: THREE.DoubleSide,
        flatShading: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      
      // Center the geometry
      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox?.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);
      
      const group = new THREE.Group();
      group.add(mesh);
      
      const components: ModelComponent[] = [{
        id: 'stl-0',
        name: 'STL Model',
        mesh: mesh,
        visible: true,
        selected: false
      }];
      
      resolve({ model: group, components });
    } catch (error) {
      reject(error);
    }
  });
}

async function loadOBJ(
  content: ArrayBuffer,
  loader: OBJLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    try {
      const text = new TextDecoder().decode(content);
      const object = loader.parse(text);
      
      const components: ModelComponent[] = [];
      let idx = 0;
      
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Always set our default purple material
          child.material = new THREE.MeshStandardMaterial({ 
            color: 0xc084fc,
            metalness: 0.1,
            roughness: 0.7,
            side: THREE.DoubleSide
          });
          
          components.push({
            id: `obj-${idx}`,
            name: child.name || `Component ${idx}`,
            mesh: child,
            visible: true,
            selected: false
          });
          idx++;
        }
      });
      
      // Center the model
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      
      resolve({ model: object, components });
    } catch (error) {
      reject(error);
    }
  });
}

async function loadGLTF(
  content: ArrayBuffer,
  loader: GLTFLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    loader.parse(
      content,
      '',
      (gltf) => {
        const scene = gltf.scene;
        const components: ModelComponent[] = [];
        let idx = 0;
        
        scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            // Always set our default purple material
            child.material = new THREE.MeshStandardMaterial({ 
              color: 0xc084fc,
              metalness: 0.1,
              roughness: 0.7,
              side: THREE.DoubleSide
            });
            
            components.push({
              id: `gltf-${idx}`,
              name: child.name || `Component ${idx}`,
              mesh: child,
              visible: true,
              selected: false
            });
            idx++;
          }
        });
        
        // Center the model
        const box = new THREE.Box3().setFromObject(scene);
        const center = box.getCenter(new THREE.Vector3());
        scene.position.sub(center);
        
        resolve({ model: scene, components });
      },
      reject
    );
  });
}

async function loadPLY(
  content: ArrayBuffer,
  loader: PLYLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    try {
      const geometry = loader.parse(content);
      const material = new THREE.MeshStandardMaterial({ 
        color: 0xc084fc,
        metalness: 0.1,
        roughness: 0.7,
        side: THREE.DoubleSide,
        vertexColors: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      
      // Center the geometry
      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox?.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);
      
      const group = new THREE.Group();
      group.add(mesh);
      
      const components: ModelComponent[] = [{
        id: 'ply-0',
        name: 'PLY Model',
        mesh: mesh,
        visible: true,
        selected: false
      }];
      
      resolve({ model: group, components });
    } catch (error) {
      reject(error);
    }
  });
}

async function load3MF(
  content: ArrayBuffer,
  loader: ThreeMFLoader
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  return new Promise((resolve, reject) => {
    try {
      const object = loader.parse(content);
      
      const components: ModelComponent[] = [];
      let idx = 0;
      
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Always set our default purple material
          child.material = new THREE.MeshStandardMaterial({ 
            color: 0xc084fc,
            metalness: 0.1,
            roughness: 0.7,
            side: THREE.DoubleSide
          });
          
          components.push({
            id: `3mf-${idx}`,
            name: child.name || `Component ${idx}`,
            mesh: child,
            visible: true,
            selected: false
          });
          idx++;
        }
      });
      
      // Center the model
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      
      resolve({ model: object, components });
    } catch (error) {
      reject(error);
    }
  });
}

async function loadSTEP(
  content: ArrayBuffer
): Promise<{ model: THREE.Group; components: ModelComponent[] }> {
  try {
    // Import the OCCT wrapper
    const { getOcctInstance } = await import('./occtLoader');
    
    // Get the initialized OCCT module
    const occt = await getOcctInstance();
    
    // Convert ArrayBuffer to Uint8Array
    const fileBuffer = new Uint8Array(content);
    
    // Read the STEP file
    const result = occt.ReadStepFile(fileBuffer);
    
    if (!result.success || !result.meshes || result.meshes.length === 0) {
      throw new Error('Failed to parse STEP file or no geometry found');
    }
    
    const group = new THREE.Group();
    const components: ModelComponent[] = [];
    
    // Process each mesh from the STEP file
    result.meshes.forEach((meshData: any, idx: number) => {
      try {
        const geometry = new THREE.BufferGeometry();
        
        // Set position attribute
        if (meshData.attributes && meshData.attributes.position) {
          const positions = meshData.attributes.position.array;
          geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
          );
        }
        
        // Set normal attribute
        if (meshData.attributes && meshData.attributes.normal) {
          const normals = meshData.attributes.normal.array;
          geometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute(normals, 3)
          );
        } else {
          geometry.computeVertexNormals();
        }
        
        // Set index
        if (meshData.index && meshData.index.array) {
          geometry.setIndex(new THREE.Uint32BufferAttribute(meshData.index.array, 1));
        }
        
        // Create material with color from STEP file if available
        const color = meshData.color || 0xc084fc;
        const material = new THREE.MeshStandardMaterial({
          color: color,
          metalness: 0.1,
          roughness: 0.7,
          side: THREE.DoubleSide,
          flatShading: false
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = meshData.name || `Part ${idx + 1}`;
        
        group.add(mesh);
        
        components.push({
          id: `step-${idx}`,
          name: mesh.name,
          mesh: mesh,
          visible: true,
          selected: false
        });
      } catch (meshError) {
        console.warn(`Failed to process mesh ${idx}:`, meshError);
      }
    });
    
    if (group.children.length === 0) {
      throw new Error('No valid geometry could be extracted from STEP file');
    }
    
    // Center the model
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    
    return { model: group, components };
    
  } catch (error) {
    console.error('STEP loading error:', error);
    throw new Error(
      `Failed to load STEP file: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      'The file may be corrupted or in an unsupported format.'
    );
  }
}
