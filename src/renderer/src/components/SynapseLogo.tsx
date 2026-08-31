import dockIcon from "../../../../build/icon-master.png";

export function SynapseLogo({ decorative = false }: { decorative?: boolean }) {
  return <img className="synapse-logo" src={dockIcon} alt={decorative ? "" : "Synapse"} draggable={false} />;
}
