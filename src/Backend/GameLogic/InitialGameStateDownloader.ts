import {
  VoyageId,
  QueuedArrival,
  LocationId,
  ArtifactId,
  Artifact,
  Player,
  RevealedCoords,
  Planet,
} from '@darkforest_eth/types';
import _ from 'lodash';
import React from 'react';
import { LoadingBarHandle } from '../../Frontend/Components/TextLoadingBar';
import { MakeDarkForestTips } from '../../Frontend/Views/DarkForestTips';
import { TerminalHandle } from '../../Frontend/Views/Terminal';
import { ContractConstants } from '../../_types/darkforest/api/ContractsAPITypes';
import PersistentChunkStore from '../Storage/PersistentChunkStore';
import ContractsAPI from './ContractsAPI';

export interface InitialGameState {
  contractConstants: ContractConstants;
  players: Map<string, Player>;
  worldRadius: number;
  allTouchedPlanetIds: LocationId[];
  allRevealedCoords: RevealedCoords[];
  pendingMoves: QueuedArrival[];
  touchedAndLocatedPlanets: Map<LocationId, Planet>;
  artifactsOnVoyages: Artifact[];
  heldArtifacts: Artifact[][];
  loadedPlanets: LocationId[];
  revealedCoordsMap: Map<LocationId, RevealedCoords>;
  planetVoyageIdMap: Map<LocationId, VoyageId[]>;
  arrivals: Map<VoyageId, QueuedArrival>;
}

export class InitialGameStateDownloader {
  private terminal: TerminalHandle;

  public constructor(terminal: TerminalHandle) {
    this.terminal = terminal;
  }

  private makeProgressListener(prettyEntityName: string) {
    const ref = React.createRef<LoadingBarHandle>();
    this.terminal.printLoadingBar(prettyEntityName, ref);
    this.terminal.newline();

    return (percent: number) => {
      ref.current?.setFractionCompleted(percent);
    };
  }

  async download(
    contractsAPI: ContractsAPI,
    persistentChunkStore: PersistentChunkStore
  ): Promise<InitialGameState> {
    const storedTouchedPlanetIds = await persistentChunkStore.getSavedTouchedPlanetIds();
    const storedRevealedCoords = await persistentChunkStore.getSavedRevealedCoords();

    this.terminal.printElement(MakeDarkForestTips());
    this.terminal.newline();

    const planetIdsLoadingBar = this.makeProgressListener('Planet IDs');
    const playersLoadingBar = this.makeProgressListener('Players');
    const revealedPlanetsLoadingBar = this.makeProgressListener('Revealed Planet IDs');
    const revealedPlanetsCoordsLoadingBar = this.makeProgressListener(
      'Revealed Planet Coordinates'
    );
    const pendingMovesLoadingBar = this.makeProgressListener('Pending Moves');
    const planetsLoadingBar = this.makeProgressListener('Planets');
    const planetsMetadataLoadingBar = this.makeProgressListener('Planet Metadatas');
    const artifactsOnPlanetsLoadingBar = this.makeProgressListener('Artifacts On Planets');
    const artifactsInFlightLoadingBar = this.makeProgressListener('Artifacts On Moves');

    const contractConstants = contractsAPI.getConstants();
    const worldRadius = contractsAPI.getWorldRadius();

    const players = contractsAPI.getPlayers(playersLoadingBar);

    const arrivals: Map<VoyageId, QueuedArrival> = new Map();
    const planetVoyageIdMap: Map<LocationId, VoyageId[]> = new Map();

    const minedChunks = Array.from(await persistentChunkStore.allChunks());
    const minedPlanetIds = new Set(
      _.flatMap(minedChunks, (c) => c.planetLocations).map((l) => l.hash)
    );

    const loadedTouchedPlanetIds = contractsAPI.getTouchedPlanetIds(
      storedTouchedPlanetIds.length,
      planetIdsLoadingBar
    );

    const loadedRevealedCoords = contractsAPI.getRevealedPlanetsCoords(
      storedRevealedCoords.length,
      revealedPlanetsLoadingBar,
      revealedPlanetsCoordsLoadingBar
    );

    const allTouchedPlanetIds = storedTouchedPlanetIds.concat(await loadedTouchedPlanetIds);
    const allRevealedCoords = storedRevealedCoords.concat(await loadedRevealedCoords);
    const revealedCoordsMap = new Map<LocationId, RevealedCoords>();
    for (const revealedCoords of allRevealedCoords) {
      revealedCoordsMap.set(revealedCoords.hash, revealedCoords);
    }

    let planetsToLoad = allTouchedPlanetIds.filter(
      (id) => minedPlanetIds.has(id) || revealedCoordsMap.has(id)
    );

    const pendingMoves = await contractsAPI.getAllArrivals(planetsToLoad, pendingMovesLoadingBar);

    // add origin points of voyages to known planets, because we need to know origin owner to render
    // the shrinking / incoming circle
    for (const arrival of pendingMoves) {
      planetsToLoad.push(arrival.fromPlanet);
    }
    planetsToLoad = [...new Set(planetsToLoad)];

    const touchedAndLocatedPlanets = await contractsAPI.bulkGetPlanets(
      planetsToLoad,
      planetsLoadingBar,
      planetsMetadataLoadingBar
    );

    touchedAndLocatedPlanets.forEach((_planet, locId) => {
      if (touchedAndLocatedPlanets.has(locId)) {
        planetVoyageIdMap.set(locId, []);
      }
    });

    for (const arrival of pendingMoves) {
      const voyageIds = planetVoyageIdMap.get(arrival.toPlanet);
      if (voyageIds) {
        voyageIds.push(arrival.eventId);
        planetVoyageIdMap.set(arrival.toPlanet, voyageIds);
      }
      arrivals.set(arrival.eventId, arrival);
    }

    const artifactIdsOnVoyages: ArtifactId[] = [];
    for (const arrival of pendingMoves) {
      if (arrival.artifactId) {
        artifactIdsOnVoyages.push(arrival.artifactId);
      }
    }

    const artifactsOnVoyages = await contractsAPI.bulkGetArtifacts(
      artifactIdsOnVoyages,
      artifactsInFlightLoadingBar
    );

    const heldArtifacts = contractsAPI.bulkGetArtifactsOnPlanets(
      planetsToLoad,
      artifactsOnPlanetsLoadingBar
    );

    return {
      contractConstants: await contractConstants,
      players: await players,
      worldRadius: await worldRadius,
      allTouchedPlanetIds,
      allRevealedCoords,
      pendingMoves,
      touchedAndLocatedPlanets,
      artifactsOnVoyages,
      heldArtifacts: await heldArtifacts,
      loadedPlanets: planetsToLoad,
      revealedCoordsMap,
      planetVoyageIdMap,
      arrivals,
    };
  }
}
