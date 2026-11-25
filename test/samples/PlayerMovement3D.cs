using UnityEngine;
using UnityEngine.SceneManagement;
using TMPro;

public class PlayerMovement3D : MonoBehaviour
{
    public CharacterController controller;
    public float speed = 6f;
    public float gravity = -9.81f;
    public TextMeshProUGUI scoreText;
    Vector3 velocity;
    int score = 0;
    int lives = 3;

    void Update()
    {
        float x = Input.GetAxis("Horizontal");
        float z = Input.GetAxis("Vertical");
        Vector3 move = transform.right * x + transform.forward * z;
        controller.Move(move * speed * Time.deltaTime);

        if (controller.isGrounded && velocity.y < 0)
        {
            velocity.y = -2f;
        }
        velocity.y += gravity * Time.deltaTime;
        controller.Move(velocity * Time.deltaTime);

        if (Input.GetMouseButtonDown(0))
        {
            RaycastHit hit;
            if (Physics.Raycast(transform.position, transform.forward, out hit, 20f))
            {
                hit.collider.gameObject.SetActive(false);
                AddScore(10);
            }
        }
    }

    void OnTriggerEnter(Collider other)
    {
        switch (other.tag)
        {
            case "Lava":
                lives -= 1;
                if (lives <= 0)
                {
                    SceneManager.LoadScene("GameOver");
                }
                break;
            case "Finish":
            case "Goal":
                SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex + 1);
                break;
            default:
                break;
        }
    }

    void AddScore(int amount)
    {
        score += amount;
        scoreText.text = $"Score: {score}";
        for (int i = 0; i < 3; i++)
        {
            transform.Rotate(0, 120, 0);
        }
    }
}
