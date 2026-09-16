import { Grid } from '@react-three/drei'

export function Scene() {
  return (
    <>
      <color attach="background" args={['#191614']} />
      <fog attach="fog" args={['#191614', 22, 48]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 12, 8]} intensity={3} color="#ffe0ad" />
      <Grid position={[32, -0.01, 0]} args={[160, 100]} cellSize={1} sectionSize={5}
        cellColor="#43382c" sectionColor="#75614b" fadeDistance={90} />
      <group name="landmarks">
        <mesh position={[0, 2, 0]} rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[3, 4, 4]} />
          <meshStandardMaterial color="#d5a666" roughness={0.85} />
        </mesh>
        <group position={[32, 0, 0]}>
          {[-2, 0, 2].map((x) => (
            <mesh key={x} position={[x, 2, 0]}>
              <boxGeometry args={[0.8, 4, 0.8]} />
              <meshStandardMaterial color="#b88c60" />
            </mesh>
          ))}
        </group>
        <mesh position={[64, 2.4, 0]}>
          <torusGeometry args={[2, 0.4, 12, 48]} />
          <meshStandardMaterial color="#c5ac86" metalness={0.4} roughness={0.4} />
        </mesh>
      </group>
    </>
  )
}
