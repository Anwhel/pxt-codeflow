using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EnemySpawner : MonoBehaviour
{
    public GameObject enemyPrefab;
    public Transform[] spawnPoints;
    public float delay = 2f;
    private List<GameObject> enemies = new List<GameObject>();
    const int MaxEnemies = 10;

    void Start()
    {
        StartCoroutine(SpawnLoop());
    }

    IEnumerator SpawnLoop()
    {
        while (true)
        {
            if (enemies.Count < MaxEnemies)
            {
                int i = Random.Range(0, spawnPoints.Length);
                GameObject e = Instantiate(enemyPrefab, spawnPoints[i].position, Quaternion.identity);
                enemies.Add(e);
            }
            yield return new WaitForSeconds(delay);
        }
    }

    public void ClearAll()
    {
        foreach (GameObject e in enemies)
        {
            if (e != null) Destroy(e);
        }
        enemies.Clear();
    }
}
